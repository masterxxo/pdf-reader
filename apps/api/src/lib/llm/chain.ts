import { ApiError } from '../../errors';
import type { TimeBudget } from '../budget';
import { outcomeFromErrorCode, type RequestMetrics } from '../metrics';
import {
  LlmProviderError,
  type JsonSchema,
  type LlmOutput,
  type LlmPrompt,
  type LlmProvider,
} from './types';

export interface GenerateOptions {
  signal?: AbortSignal;
  /** True for the correction attempt that follows invalid output. */
  isRetry?: boolean;
  /** Name of the call in metrics, e.g. "analyze" or "retry". */
  label?: string;
  maxOutputTokens?: number;
}

export interface ProviderChainOptions {
  /** Longest wait before re-sending a rate-limited correction attempt. */
  maxRetryWaitMs?: number;
  /** Wait used when a 429 response has no Retry-After header. */
  defaultRetryWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Records every provider call (duration, outcome, token usage). */
  metrics?: RequestMetrics;
  /**
   * Deadline shared by all calls: each call gets the remaining time as its
   * timeout, and no call starts when too little is left. Without it, each
   * provider uses its own default timeout.
   */
  budget?: TimeBudget;
}

interface CallOptions {
  signal: AbortSignal | undefined;
  label: string;
  maxOutputTokens: number | undefined;
}

const DEFAULT_MAX_RETRY_WAIT_MS = 2_000;
const DEFAULT_RETRY_WAIT_MS = 1_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Calls providers in order of preference. A transport or upstream failure
 * (429, 5xx, timeout, network error) moves on to the next provider. Invalid
 * output is not handled here: the caller retries it, and the retry goes to the
 * provider that produced the invalid output.
 */
export class ProviderChain {
  readonly #providers: readonly LlmProvider[];
  readonly #maxRetryWaitMs: number;
  readonly #defaultRetryWaitMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #metrics: RequestMetrics | undefined;
  readonly #budget: TimeBudget | undefined;
  /** Index of the provider that produced the last output. */
  #current = 0;
  #lastProvider: string | undefined;

  constructor(providers: readonly LlmProvider[], options: ProviderChainOptions = {}) {
    if (providers.length === 0) {
      throw new ApiError('INTERNAL', { cause: new Error('No LLM provider is configured') });
    }
    this.#providers = providers;
    this.#maxRetryWaitMs = options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;
    this.#defaultRetryWaitMs = options.defaultRetryWaitMs ?? DEFAULT_RETRY_WAIT_MS;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#metrics = options.metrics;
    this.#budget = options.budget;
  }

  /** Name of the provider that produced the last output, if any. */
  get lastProvider(): string | undefined {
    return this.#lastProvider;
  }

  async generate(
    prompt: LlmPrompt,
    jsonSchema: JsonSchema,
    options: GenerateOptions = {},
  ): Promise<string> {
    const {
      signal,
      isRetry = false,
      label = isRetry ? 'retry' : 'analyze',
      maxOutputTokens,
    } = options;
    const call: CallOptions = { signal, label, maxOutputTokens };

    for (let index = this.#current; index < this.#providers.length; index++) {
      const provider = this.#providers[index];
      if (!provider) {
        break;
      }
      try {
        const output = await this.#call(provider, prompt, jsonSchema, call, isRetry);
        this.#current = index;
        this.#lastProvider = provider.name;
        return output.text;
      } catch (error) {
        const isLast = index === this.#providers.length - 1;
        if (isLast || !(error instanceof LlmProviderError) || !error.canFallback) {
          throw error;
        }
      }
    }
    throw new ApiError('LLM_UNAVAILABLE');
  }

  /**
   * A correction attempt follows the first call within about a second, which
   * free plans often reject as too many requests per second. It is re-sent
   * once after a short wait, so it does not needlessly fall back.
   */
  async #call(
    provider: LlmProvider,
    prompt: LlmPrompt,
    jsonSchema: JsonSchema,
    call: CallOptions,
    isRetry: boolean,
  ): Promise<LlmOutput> {
    try {
      return await this.#timedCall(provider, prompt, jsonSchema, call);
    } catch (error) {
      if (!isRetry || !(error instanceof LlmProviderError) || error.code !== 'RATE_LIMITED') {
        throw error;
      }
      const waitMs = error.retryAfterMs ?? this.#defaultRetryWaitMs;
      // A longer Retry-After means a quota is exhausted; waiting will not help.
      if (waitMs > this.#maxRetryWaitMs) {
        throw error;
      }
      await this.#sleep(waitMs);
      return this.#timedCall(provider, prompt, jsonSchema, call);
    }
  }

  async #timedCall(
    provider: LlmProvider,
    prompt: LlmPrompt,
    jsonSchema: JsonSchema,
    { signal, label, maxOutputTokens }: CallOptions,
  ): Promise<LlmOutput> {
    const metrics = this.#metrics;
    let timeoutMs: number | undefined;
    try {
      // Throws LLM_TIMEOUT (not a provider error, so no fallback) when too little time is left.
      timeoutMs = this.#budget?.attemptTimeoutMs();
    } catch (error) {
      metrics?.log('budget_exhausted', {
        provider: provider.name,
        label,
        remainingMs: this.#budget?.remainingMs(),
      });
      throw error;
    }
    const startedAt = metrics?.now() ?? 0;
    const elapsed = () => (metrics ? metrics.now() - startedAt : 0);
    try {
      const output = await provider.generate(prompt, jsonSchema, {
        signal,
        timeoutMs,
        maxOutputTokens,
      });
      metrics?.recordAttempt({
        provider: provider.name,
        label,
        durationMs: elapsed(),
        outcome: 'ok',
        usage: output.usage,
        finishReason: output.finishReason,
      });
      return output;
    } catch (error) {
      metrics?.recordAttempt({
        provider: provider.name,
        label,
        durationMs: elapsed(),
        outcome: error instanceof ApiError ? outcomeFromErrorCode(error.code) : 'unavailable',
      });
      throw error;
    }
  }
}
