import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { TimeBudget } from './budget';

function budgetAt(time: { now: number }) {
  return new TimeBudget({
    deadline: 27_000,
    safetyMarginMs: 1_500,
    minAttemptMs: 8_000,
    now: () => time.now,
  });
}

describe('TimeBudget', () => {
  it('gives a call the remaining time minus the safety margin', () => {
    const time = { now: 2_000 };
    const budget = budgetAt(time);

    expect(budget.remainingMs()).toBe(25_000);
    expect(budget.attemptTimeoutMs()).toBe(23_500);
    time.now = 15_000;
    expect(budget.attemptTimeoutMs()).toBe(10_500);
  });

  it('refuses to start a call with less than the minimum attempt time left', () => {
    const time = { now: 17_600 };
    const budget = budgetAt(time);

    expect(budget.canStart()).toBe(false);
    expect(() => budget.attemptTimeoutMs()).toThrow(ApiError);
    try {
      budget.attemptTimeoutMs();
    } catch (error) {
      expect(error instanceof ApiError && error.code).toBe('LLM_TIMEOUT');
    }
  });

  it('never reports negative time', () => {
    const budget = budgetAt({ now: 40_000 });
    expect(budget.remainingMs()).toBe(0);
    expect(budget.availableMs()).toBe(0);
  });

  it('accepts a custom minimum for canStart', () => {
    const budget = budgetAt({ now: 20_000 });
    expect(budget.canStart()).toBe(false);
    expect(budget.canStart(5_000)).toBe(true);
  });
});
