import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../errors';
import { TimeBudget } from '../budget';
import { makeLlmAnalysis } from '../../test/fixtures';
import { analyzeText } from '../analyze';
import { ProviderChain, type ProviderChainOptions } from './chain';
import { LlmProviderError, type LlmProvider } from './types';

type Step = string | LlmProviderError;

/** A provider that returns (or throws) the given steps in order, repeating the last one. */
function fakeProvider(name: string, steps: Step[]) {
  const generate = vi.fn<LlmProvider['generate']>(() => {
    const step = steps.length > 1 ? steps.shift() : steps[0];
    if (step === undefined) {
      throw new Error('No step configured');
    }
    return typeof step === 'string' ? Promise.resolve({ text: step }) : Promise.reject(step);
  });
  return { name, generate };
}

const VALID = JSON.stringify(makeLlmAnalysis());

const rateLimited = (retryAfterMs?: number) =>
  new LlmProviderError('RATE_LIMITED', { canFallback: true, retryAfterMs });
const unavailable = () => new LlmProviderError('LLM_UNAVAILABLE', { canFallback: true });
const timeout = () => new LlmProviderError('LLM_TIMEOUT', { canFallback: true });
const rejected = () => new LlmProviderError('LLM_UNAVAILABLE', { canFallback: false });

function createChain(providers: LlmProvider[], options: ProviderChainOptions = {}) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  return { chain: new ProviderChain(providers, { sleep, ...options }), sleep };
}

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('ProviderChain with analyzeText', () => {
  it('uses Mistral when it answers', async () => {
    const mistral = fakeProvider('mistral', [VALID]);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain } = createChain([mistral, gemini]);

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(chain.lastProvider).toBe('mistral');
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['429', rateLimited()],
    ['5xx', unavailable()],
    ['a timeout', timeout()],
  ])('falls back to Gemini when Mistral fails with %s', async (_name, error) => {
    const mistral = fakeProvider('mistral', [error]);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain, sleep } = createChain([mistral, gemini]);

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(chain.lastProvider).toBe('gemini');
    expect(mistral.generate).toHaveBeenCalledTimes(1);
    // The first attempt falls back immediately, without waiting.
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not fall back on errors that are not outages (e.g. HTTP 400)', async () => {
    const mistral = fakeProvider('mistral', [rejected()]);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain } = createChain([mistral, gemini]);

    expect((await errorOf(analyzeText('Treść', chain))).code).toBe('LLM_UNAVAILABLE');
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it('retries invalid output on Mistral, without falling back', async () => {
    const mistral = fakeProvider('mistral', ['nie JSON', VALID]);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain } = createChain([mistral, gemini]);

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(mistral.generate).toHaveBeenCalledTimes(2);
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it('fails with LLM_INVALID_OUTPUT after two invalid Mistral responses', async () => {
    const mistral = fakeProvider('mistral', ['nie JSON']);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain } = createChain([mistral, gemini]);

    expect((await errorOf(analyzeText('Treść', chain))).code).toBe('LLM_INVALID_OUTPUT');
    expect(mistral.generate).toHaveBeenCalledTimes(2);
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it('sends the retry to the provider that produced the invalid output', async () => {
    const mistral = fakeProvider('mistral', [unavailable()]);
    const gemini = fakeProvider('gemini', ['nie JSON', VALID]);
    const { chain } = createChain([mistral, gemini]);

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(mistral.generate).toHaveBeenCalledTimes(1);
    expect(gemini.generate).toHaveBeenCalledTimes(2);
  });

  it('fails with LLM_UNAVAILABLE when both providers are down', async () => {
    const mistral = fakeProvider('mistral', [unavailable()]);
    const gemini = fakeProvider('gemini', [unavailable()]);
    const { chain } = createChain([mistral, gemini]);

    expect((await errorOf(analyzeText('Treść', chain))).code).toBe('LLM_UNAVAILABLE');
    expect(mistral.generate).toHaveBeenCalledTimes(1);
    expect(gemini.generate).toHaveBeenCalledTimes(1);
  });

  it('waits for Retry-After when the retry is rate limited, then re-sends it to Mistral', async () => {
    const mistral = fakeProvider('mistral', ['nie JSON', rateLimited(1500), VALID]);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain, sleep } = createChain([mistral, gemini]);

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1500);
    expect(mistral.generate).toHaveBeenCalledTimes(3);
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it('waits a default time when the rate limited retry has no Retry-After', async () => {
    const mistral = fakeProvider('mistral', ['nie JSON', rateLimited(), VALID]);
    const { chain, sleep } = createChain([mistral], { defaultRetryWaitMs: 700 });

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(sleep).toHaveBeenCalledExactlyOnceWith(700);
  });

  it('falls back without waiting when Retry-After exceeds the maximum wait', async () => {
    const mistral = fakeProvider('mistral', ['nie JSON', rateLimited(30_000)]);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain, sleep } = createChain([mistral, gemini]);

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(sleep).not.toHaveBeenCalled();
    expect(chain.lastProvider).toBe('gemini');
  });

  it('falls back when the re-sent retry is rate limited again', async () => {
    const mistral = fakeProvider('mistral', ['nie JSON', rateLimited(500), rateLimited(500)]);
    const gemini = fakeProvider('gemini', [VALID]);
    const { chain, sleep } = createChain([mistral, gemini]);

    await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mistral.generate).toHaveBeenCalledTimes(3);
    expect(gemini.generate).toHaveBeenCalledTimes(1);
  });

  describe('with a time budget', () => {
    /** A budget on a manual clock; each provider call advances it by `callMs`. */
    function budgetedChain(steps: Record<string, Step[]>, callMs: number) {
      let time = 0;
      const budget = new TimeBudget({
        deadline: 27_000,
        safetyMarginMs: 1_000,
        minAttemptMs: 8_000,
        now: () => time,
      });
      const providers = Object.entries(steps).map(([name, providerSteps]) => {
        const provider = fakeProvider(name, providerSteps);
        const generate = provider.generate.getMockImplementation();
        provider.generate.mockImplementation((...args) => {
          time += callMs;
          return generate ? generate(...args) : Promise.reject(new Error('No step'));
        });
        return provider;
      });
      return { chain: createChain(providers, { budget }).chain, providers };
    }

    it('gives each call the remaining time minus the safety margin as its timeout', async () => {
      const { chain, providers } = budgetedChain({ mistral: ['nie JSON', VALID] }, 5_000);

      await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
      const timeouts = providers[0]?.generate.mock.calls.map(([, , options]) => options?.timeoutMs);
      expect(timeouts).toEqual([26_000, 21_000]);
    });

    it('does not start the fallback when too little time is left', async () => {
      const { chain, providers } = budgetedChain({ mistral: [timeout()], gemini: [VALID] }, 20_000);

      expect((await errorOf(analyzeText('Treść', chain))).code).toBe('LLM_TIMEOUT');
      expect(providers[1]?.generate).not.toHaveBeenCalled();
    });

    it('does not start the retry when too little time is left', async () => {
      const { chain, providers } = budgetedChain({ mistral: ['nie JSON', VALID] }, 19_000);

      expect((await errorOf(analyzeText('Treść', chain))).code).toBe('LLM_TIMEOUT');
      expect(providers[0]?.generate).toHaveBeenCalledTimes(1);
    });

    it('still falls back when a fast failure leaves enough time', async () => {
      const { chain } = budgetedChain({ mistral: [rateLimited()], gemini: [VALID] }, 500);

      await expect(analyzeText('Treść', chain)).resolves.toEqual(makeLlmAnalysis());
      expect(chain.lastProvider).toBe('gemini');
    });
  });

  it('requires at least one provider', () => {
    expect(() => new ProviderChain([])).toThrow(ApiError);
  });
});
