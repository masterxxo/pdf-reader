import { z } from 'zod';
import { ApiError } from '../errors';

/** One turn of the conversation with the model. */
export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GenerateJsonRequest {
  systemInstruction: string;
  messages: readonly ChatMessage[];
  /** JSON Schema the response must follow. */
  responseSchema: Record<string, unknown>;
}

/**
 * Sends a conversation to the model and returns the raw text of its JSON
 * response (unparsed). Throws ApiError (LLM_TIMEOUT / LLM_UNAVAILABLE /
 * RATE_LIMITED) on transport and upstream failures.
 */
export type GenerateJson = (request: GenerateJsonRequest) => Promise<string>;

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
  fetch?: typeof fetch;
}

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_LLM_TIMEOUT_MS = 25_000;
const DEFAULT_TEMPERATURE = 0.2;

// Only the fields we read; everything else in the response is ignored.
const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(z.object({ text: z.string().optional(), thought: z.boolean().optional() }))
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

/** Gemini rejects the "$schema" keyword in response schemas. */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function createGeminiClient(options: GeminiClientOptions): GenerateJson {
  const {
    apiKey,
    model,
    timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
    temperature = DEFAULT_TEMPERATURE,
    fetch: fetchImpl = fetch,
  } = options;
  const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;

  return async ({ systemInstruction, messages, responseSchema }) => {
    const body = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: messages.map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
        responseJsonSchema: toGeminiSchema(responseSchema),
      },
    };

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ApiError(isAbortError(error) ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE', { cause: error });
    }

    // Gemini quota exceeded (the free tier allows only a few requests per minute).
    if (response.status === 429) {
      throw new ApiError('RATE_LIMITED', {
        cause: new Error('Gemini responded with HTTP 429'),
      });
    }

    // The upstream body may echo request details, so it is never passed on.
    if (!response.ok) {
      throw new ApiError('LLM_UNAVAILABLE', {
        cause: new Error(`Gemini responded with HTTP ${String(response.status)}`),
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ApiError(isAbortError(error) ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE', { cause: error });
    }

    const parsed = GeminiResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError('LLM_UNAVAILABLE', { cause: parsed.error });
    }

    // A blocked or empty candidate yields "", which the caller treats as invalid output.
    const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((part) => part.thought !== true)
      .map((part) => part.text ?? '')
      .join('');
  };
}
