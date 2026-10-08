import type { LlmAnalysis } from '@pdf-insight/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors';
import { makeLlmAnalysis } from '../test/fixtures';
import {
  REDUCE_RESERVE_MS,
  analyzeDocument,
  mapWithConcurrency,
  partialLimits,
  type LlmClient,
  type LongDocumentConfig,
  type PartialAnalysis,
} from './analyze';
import { TimeBudget } from './budget';
import type { GenerateOptions } from './llm/chain';
import type { JsonSchema, LlmPrompt } from './llm/types';

const CONFIG: LongDocumentConfig = { singleCallMaxTokens: 1_000, maxChunks: 3, concurrency: 2 };

/** ~1,800 tokens in paragraphs: two chunks with CONFIG. */
const LONG_TEXT = Array.from(
  { length: 20 },
  (_, i) => `Akapit ${String(i + 1)}. ${'Treść umowy. '.repeat(18)}`,
).join('\n\n');

function makePartial(n: number): PartialAnalysis {
  return {
    document: {
      language: 'pl',
      type: 'contract',
      title: n === 1 ? 'Umowa ramowa' : null,
      date: null,
    },
    facts: [`Fakt z części ${String(n)}`],
    entities: {
      organizations: [`Firma ${String(n)}`, 'ACME S.A.'],
      people: [`Osoba ${String(n)}`],
    },
    amounts: [{ value: 1000 * n, currency: 'PLN', context: `Kwota ${String(n)}` }],
    dates: [{ date: `2026-0${String(n)}-01`, context: `Termin ${String(n)}` }],
    keywords: [`słowo ${String(n)}`],
  };
}

const REDUCED = {
  document: { language: 'pl', type: 'contract', title: 'Umowa ramowa', date: '2026-01-01' },
  summary: 'Umowa ramowa między stronami. Określa kwoty i terminy.',
  keyPoints: ['Punkt pierwszy', 'Punkt drugi', 'Punkt trzeci'],
  keywords: ['umowa'],
} satisfies Partial<LlmAnalysis>;

interface Call {
  prompt: LlmPrompt;
  schema: JsonSchema;
  options: GenerateOptions;
}

/** Answers map calls with a partial for their part, reduce with REDUCED, single calls with a full result. */
function fakeLlm(overrides: Record<string, () => Promise<string>> = {}) {
  const calls: Call[] = [];
  const generate = vi.fn((prompt: LlmPrompt, schema: JsonSchema, options: GenerateOptions = {}) => {
    calls.push({ prompt, schema, options });
    const label = options.label ?? '';
    const override = overrides[label];
    if (override) {
      return override();
    }
    const part = /^map-(\d+)(?:-retry)?$/.exec(label);
    if (part) {
      return Promise.resolve(JSON.stringify(makePartial(Number(part[1]))));
    }
    return Promise.resolve(JSON.stringify(label === 'reduce' ? REDUCED : makeLlmAnalysis()));
  });
  const llm: LlmClient = { generate };
  return { llm, calls, generate };
}

const userText = (call: Call | undefined) => call?.prompt.messages[0]?.text ?? '';

describe('analyzeDocument', () => {
  it('uses a single call when the text fits', async () => {
    const { llm, calls } = fakeLlm();

    await expect(analyzeDocument('Krótka umowa.', llm, { config: CONFIG })).resolves.toEqual(
      makeLlmAnalysis(),
    );
    expect(calls.map((call) => call.options.label)).toEqual(['analyze']);
  });

  it('maps every chunk, then reduces, and merges the lists in code', async () => {
    const { llm, calls } = fakeLlm();

    const result = await analyzeDocument(LONG_TEXT, llm, { config: CONFIG });

    expect(calls.map((call) => call.options.label)).toEqual(['map-1', 'map-2', 'reduce']);
    expect(result).toEqual({
      ...REDUCED,
      entities: {
        organizations: ['Firma 1', 'Firma 2', 'ACME S.A.'],
        people: ['Osoba 1', 'Osoba 2'],
      },
      amounts: [
        { value: 1000, currency: 'PLN', context: 'Kwota 1' },
        { value: 2000, currency: 'PLN', context: 'Kwota 2' },
      ],
      dates: [
        { date: '2026-01-01', context: 'Termin 1' },
        { date: '2026-02-01', context: 'Termin 2' },
      ],
    });
  });

  it('sends each chunk once, as delimited data with its position and lower limits', async () => {
    const { llm, calls } = fakeLlm();
    await analyzeDocument(LONG_TEXT, llm, { config: CONFIG });

    const [map1, map2] = calls;
    expect(userText(map1)).toContain('part 1 of 2');
    expect(userText(map2)).toContain('part 2 of 2');
    expect(userText(map1)).toContain('at most 8 organizations, 8 people, 5 amounts, 5 dates');
    expect(userText(map1)).toContain('<document>\nAkapit 1.');
    expect(userText(map2)).not.toContain('Akapit 1.');
    expect(map1?.schema).toMatchObject({
      properties: {
        amounts: { maxItems: 5 },
        entities: { properties: { people: { maxItems: 8 } } },
      },
    });
  });

  it('gives the reduce step only the facts, keywords and document fields of each part', async () => {
    const { llm, calls } = fakeLlm();
    await analyzeDocument(LONG_TEXT, llm, { config: CONFIG });

    const reducePrompt = userText(calls[2]);
    expect(reducePrompt).toContain('Fakt z części 1');
    expect(reducePrompt).toContain('Fakt z części 2');
    expect(reducePrompt).not.toContain('Treść umowy');
    expect(reducePrompt).not.toContain('Kwota 1');
    expect(calls[2]?.prompt.systemInstruction).toContain('untrusted DATA');
  });

  it('rejects text needing more than maxChunks chunks without calling the model', async () => {
    const { llm, generate } = fakeLlm();
    const error: unknown = await analyzeDocument(LONG_TEXT, llm, {
      config: { ...CONFIG, maxChunks: 1 },
    }).catch((caught: unknown) => caught);

    expect(error instanceof ApiError && error.code).toBe('TEXT_TOO_LONG');
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails without reducing when a chunk fails, and aborts the other chunks', async () => {
    const { llm, calls } = fakeLlm({
      'map-1': () => Promise.reject(new ApiError('LLM_UNAVAILABLE')),
    });
    const error: unknown = await analyzeDocument(LONG_TEXT, llm, { config: CONFIG }).catch(
      (caught: unknown) => caught,
    );

    expect(error instanceof ApiError && error.code).toBe('LLM_UNAVAILABLE');
    expect(calls.map((call) => call.options.label)).not.toContain('reduce');
    expect(calls.find((call) => call.options.label === 'map-2')?.options.signal?.aborted).toBe(
      true,
    );
  });

  it('retries an invalid partial once', async () => {
    const { llm, calls } = fakeLlm({ 'map-2': () => Promise.resolve('nie JSON') });

    await analyzeDocument(LONG_TEXT, llm, { config: CONFIG });
    expect(calls.map((call) => call.options.label)).toEqual([
      'map-1',
      'map-2',
      'map-2-retry',
      'reduce',
    ]);
  });

  it('keeps time for the reduce step while mapping, and waits on 429 in the map step', async () => {
    const budget = new TimeBudget({ deadline: 27_000, now: () => 0 });
    const { llm, calls } = fakeLlm();
    await analyzeDocument(LONG_TEXT, llm, { config: CONFIG, budget });

    const [map1, , reduce] = calls;
    expect(map1?.options.budget?.remainingMs()).toBe(27_000 - REDUCE_RESERVE_MS);
    expect(map1?.options.waitOnRateLimit).toBe(true);
    expect(reduce?.options.budget).toBe(budget);
  });
});

describe('partialLimits', () => {
  it('splits each list limit between the chunks, rounding up', () => {
    expect(partialLimits(2)).toMatchObject({ organizations: 8, people: 8, amounts: 5, dates: 5 });
    expect(partialLimits(1)).toMatchObject({ organizations: 15, amounts: 10 });
    expect(partialLimits(30)).toMatchObject({ organizations: 1, amounts: 1 });
  });
});

describe('mapWithConcurrency', () => {
  it('returns results in item order with at most `concurrency` calls running', async () => {
    let running = 0;
    let maxRunning = 0;
    const results = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms, index) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running--;
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3]);
    expect(maxRunning).toBe(2);
  });

  it('starts no new item after a failure', async () => {
    const fn = vi.fn((item: number) =>
      item === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(item),
    );
    await expect(mapWithConcurrency([1, 2, 3], 1, fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
