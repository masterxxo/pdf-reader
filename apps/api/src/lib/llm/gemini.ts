import { z } from 'zod';
import { postJson } from './http';
import {
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_TEMPERATURE,
  LlmProviderError,
  withoutSchemaKeyword,
  type LlmProvider,
} from './types';

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
  fetch?: typeof fetch;
}

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

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
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
});

export function createGeminiProvider(options: GeminiProviderOptions): LlmProvider {
  const {
    apiKey,
    model,
    timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
    temperature = DEFAULT_TEMPERATURE,
    fetch: fetchImpl = fetch,
  } = options;
  const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;

  return {
    name: 'gemini',
    async generate({ systemInstruction, messages }, jsonSchema, callOptions = {}) {
      const body = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.text }],
        })),
        generationConfig: {
          temperature,
          responseMimeType: 'application/json',
          // Gemini rejects the "$schema" keyword in response schemas.
          responseJsonSchema: withoutSchemaKeyword(jsonSchema),
        },
      };

      const payload = await postJson({
        provider: 'Gemini',
        url,
        headers: { 'x-goog-api-key': apiKey },
        body,
        timeoutMs: callOptions.timeoutMs ?? timeoutMs,
        signal: callOptions.signal,
        fetch: fetchImpl,
      });

      const parsed = GeminiResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new LlmProviderError('LLM_UNAVAILABLE', { canFallback: true, cause: parsed.error });
      }

      const candidate = parsed.data.candidates?.[0];
      const usage = parsed.data.usageMetadata;
      // A blocked or empty candidate yields "", which the caller treats as invalid output.
      const parts = candidate?.content?.parts ?? [];
      const text = parts
        .filter((part) => part.thought !== true)
        .map((part) => part.text ?? '')
        .join('');
      return {
        text,
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount ?? 0,
              // Thinking tokens are billed and generated like output tokens.
              outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            }
          : undefined,
        finishReason: candidate?.finishReason,
      };
    },
  };
}
