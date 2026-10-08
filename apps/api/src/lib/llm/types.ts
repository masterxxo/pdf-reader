import type { ApiErrorCode } from '@pdf-insight/shared';
import { ApiError } from '../../errors';

/** One turn of the conversation with the model. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface LlmPrompt {
  systemInstruction: string;
  messages: readonly ChatMessage[];
}

/** JSON Schema the response must follow. */
export type JsonSchema = Record<string, unknown>;

export interface LlmProvider {
  /** Short identifier, e.g. "mistral" (returned in the X-LLM-Provider header). */
  readonly name: string;
  /**
   * Sends the prompt to the model and returns the raw text of its JSON
   * response (unparsed). Throws LlmProviderError on transport and upstream
   * failures.
   */
  generate(prompt: LlmPrompt, jsonSchema: JsonSchema, signal?: AbortSignal): Promise<string>;
}

export const DEFAULT_LLM_TIMEOUT_MS = 25_000;
export const DEFAULT_TEMPERATURE = 0.2;

/** A transport or upstream failure of a single provider call. */
export class LlmProviderError extends ApiError {
  /** Whether another provider may be tried (429, 5xx, timeout, network error). */
  readonly canFallback: boolean;
  /** From the Retry-After header of a 429 response, if present. */
  readonly retryAfterMs: number | undefined;

  constructor(
    code: ApiErrorCode,
    options: { canFallback: boolean; retryAfterMs?: number; cause?: unknown },
  ) {
    super(code, { cause: options.cause });
    this.name = 'LlmProviderError';
    this.canFallback = options.canFallback;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Removes the "$schema" keyword, which provider APIs reject or ignore. */
export function withoutSchemaKeyword(schema: JsonSchema): JsonSchema {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'));
}
