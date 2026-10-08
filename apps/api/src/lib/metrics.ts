import type { ApiErrorCode } from '@pdf-insight/shared';
import type { LlmUsage } from './llm/types';

/** Rough token estimate for budgeting; Mistral averages ~3.5 chars per token on Polish text. */
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Result of one provider call, as far as the API can tell. */
export type AttemptOutcome =
  'ok' | 'invalid_json' | 'invalid_schema' | 'timeout' | 'rate_limited' | 'unavailable';

export interface LlmAttempt {
  provider: string;
  /** What the call was for, e.g. "analyze", "retry", "map-2", "reduce". */
  label: string;
  durationMs: number;
  outcome: AttemptOutcome;
  usage?: LlmUsage;
  finishReason?: string;
}

export function outcomeFromErrorCode(code: ApiErrorCode): AttemptOutcome {
  switch (code) {
    case 'LLM_TIMEOUT':
      return 'timeout';
    case 'RATE_LIMITED':
      return 'rate_limited';
    default:
      return 'unavailable';
  }
}

export type DebugLog = (event: string, data: Record<string, unknown>) => void;

/** Writes structured debug lines when enabled (DEBUG var), otherwise does nothing. */
export function createDebugLog(enabled: boolean): DebugLog {
  if (!enabled) {
    return () => undefined;
  }
  return (event, data) => {
    // eslint-disable-next-line no-console -- opt-in diagnostics, off unless DEBUG is set
    console.debug(JSON.stringify({ event, ...data }));
  };
}

/** Quotes a value for a Server-Timing desc parameter. */
function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/**
 * Timings and sizes of one /analyze request, returned in the Server-Timing
 * header (visible in browser dev tools) and, with DEBUG set, logged.
 * Contains no document content.
 */
export class RequestMetrics {
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #attempts: LlmAttempt[] = [];
  readonly #sizes: Record<string, number> = {};
  readonly log: DebugLog;

  constructor(options: { now?: () => number; log?: DebugLog } = {}) {
    this.#now = options.now ?? Date.now;
    this.#startedAt = this.#now();
    this.log = options.log ?? (() => undefined);
  }

  get attempts(): readonly LlmAttempt[] {
    return this.#attempts;
  }

  /** Milliseconds since the request started. */
  elapsedMs(): number {
    return this.#now() - this.#startedAt;
  }

  now(): number {
    return this.#now();
  }

  /** Records a size, e.g. the text length in characters or estimated tokens. */
  size(name: string, value: number): void {
    this.#sizes[name] = value;
    this.log('size', { name, value });
  }

  recordAttempt(attempt: LlmAttempt): void {
    this.#attempts.push(attempt);
    this.log('llm_attempt', { ...attempt, elapsedMs: this.elapsedMs() });
  }

  /** Refines the outcome of the latest successful call once its output has been parsed. */
  setLastParseOutcome(outcome: 'ok' | 'invalid_json' | 'invalid_schema'): void {
    const last = this.#attempts.at(-1);
    if (last?.outcome === 'ok') {
      last.outcome = outcome;
      if (outcome !== 'ok') {
        this.log('llm_invalid_output', { label: last.label, outcome });
      }
    }
  }

  toServerTiming(): string {
    const entries = [`total;dur=${String(this.elapsedMs())}`];
    const sizes = Object.entries(this.#sizes).map(([name, value]) => `${name}=${String(value)}`);
    if (sizes.length > 0) {
      entries.push(`text;desc=${quote(sizes.join(' '))}`);
    }
    this.#attempts.forEach((attempt, index) => {
      const details = [attempt.provider, attempt.label, attempt.outcome];
      if (attempt.usage) {
        details.push(
          `in=${String(attempt.usage.inputTokens)}`,
          `out=${String(attempt.usage.outputTokens)}`,
        );
      }
      if (attempt.finishReason) {
        details.push(`finish=${attempt.finishReason}`);
      }
      entries.push(
        `llm${String(index + 1)};dur=${String(attempt.durationMs)};desc=${quote(details.join(' '))}`,
      );
    });
    return entries.join(', ');
  }
}
