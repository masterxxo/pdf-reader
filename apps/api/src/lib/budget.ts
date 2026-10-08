import { ApiError } from '../errors';

/** Whole /analyze request, leaving the client (30 s target) time to receive the response. */
export const REQUEST_BUDGET_MS = 27_000;
/** Kept free after every LLM call for parsing, caching and sending the response. */
export const SAFETY_MARGIN_MS = 1_500;
/** A call with less time than this would most likely time out, so it is not started. */
export const MIN_ATTEMPT_MS = 8_000;

export interface TimeBudgetOptions {
  /** Absolute time (ms, same clock as `now`) by which the response must be ready. */
  deadline: number;
  safetyMarginMs?: number;
  minAttemptMs?: number;
  now?: () => number;
}

/**
 * One deadline shared by every LLM call of a request (first attempt, retry,
 * fallback, chunks), instead of independent per-provider timeouts that add up.
 */
export class TimeBudget {
  readonly #deadline: number;
  readonly #safetyMarginMs: number;
  readonly #minAttemptMs: number;
  readonly #now: () => number;

  constructor(options: TimeBudgetOptions) {
    this.#deadline = options.deadline;
    this.#safetyMarginMs = options.safetyMarginMs ?? SAFETY_MARGIN_MS;
    this.#minAttemptMs = options.minAttemptMs ?? MIN_ATTEMPT_MS;
    this.#now = options.now ?? Date.now;
  }

  /** The same budget, ending `reserveMs` earlier (keeps time for a later step). */
  withReserve(reserveMs: number): TimeBudget {
    return new TimeBudget({
      deadline: this.#deadline - reserveMs,
      safetyMarginMs: this.#safetyMarginMs,
      minAttemptMs: this.#minAttemptMs,
      now: this.#now,
    });
  }

  remainingMs(): number {
    return Math.max(0, this.#deadline - this.#now());
  }

  /** Time available to a call started now, after the safety margin. */
  availableMs(): number {
    return Math.max(0, this.remainingMs() - this.#safetyMarginMs);
  }

  /** Whether a call needing `minMs` (default: the minimum attempt time) can still start. */
  canStart(minMs = this.#minAttemptMs): boolean {
    return this.availableMs() >= minMs;
  }

  /**
   * Timeout for an LLM call about to start: everything that is left. Throws
   * LLM_TIMEOUT when too little is left, so the call is not started at all.
   */
  attemptTimeoutMs(): number {
    if (!this.canStart()) {
      throw new ApiError('LLM_TIMEOUT');
    }
    return this.availableMs();
  }
}
