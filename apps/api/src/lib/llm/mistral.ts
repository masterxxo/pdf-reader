import { z } from 'zod';
import { postJson } from './http';
import {
  DEFAULT_TEMPERATURE,
  LlmProviderError,
  withoutSchemaKeyword,
  type LlmProvider,
} from './types';

export interface MistralProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
  fetch?: typeof fetch;
}

const MISTRAL_CHAT_COMPLETIONS_URL = 'https://api.mistral.ai/v1/chat/completions';
/** Shorter than Gemini's, so a fallback still fits in the client's timeout. */
export const DEFAULT_MISTRAL_TIMEOUT_MS = 20_000;

// Content is a string, or an array of chunks for reasoning models (thinking
// chunks are skipped). Only the fields we read are listed.
const ContentChunkSchema = z.object({ type: z.string(), text: z.string().optional() });
const MistralResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.union([z.string(), z.array(ContentChunkSchema)]).nullish(),
          })
          .optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullish(),
});

export function createMistralProvider(options: MistralProviderOptions): LlmProvider {
  const {
    apiKey,
    model,
    timeoutMs = DEFAULT_MISTRAL_TIMEOUT_MS,
    temperature = DEFAULT_TEMPERATURE,
    fetch: fetchImpl = fetch,
  } = options;

  return {
    name: 'mistral',
    async generate({ systemInstruction, messages }, jsonSchema, callOptions = {}) {
      const body = {
        model,
        temperature,
        messages: [
          { role: 'system', content: systemInstruction },
          ...messages.map((message) => ({ role: message.role, content: message.text })),
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'document_analysis',
            schema: withoutSchemaKeyword(jsonSchema),
            strict: true,
          },
        },
      };

      const payload = await postJson({
        provider: 'Mistral',
        url: MISTRAL_CHAT_COMPLETIONS_URL,
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
        timeoutMs: callOptions.timeoutMs ?? timeoutMs,
        signal: callOptions.signal,
        fetch: fetchImpl,
      });

      const parsed = MistralResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new LlmProviderError('LLM_UNAVAILABLE', { canFallback: true, cause: parsed.error });
      }

      const choice = parsed.data.choices?.[0];
      const { usage } = parsed.data;
      // Missing content yields "", which the caller treats as invalid output.
      const content = choice?.message?.content ?? '';
      const text =
        typeof content === 'string'
          ? content
          : content
              .filter((chunk) => chunk.type === 'text')
              .map((chunk) => chunk.text ?? '')
              .join('');
      return {
        text,
        usage: usage
          ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
          : undefined,
        finishReason: choice?.finish_reason ?? undefined,
      };
    },
  };
}
