import { describe, expect, it } from 'vitest';
import {
  AnalysisResultSchema,
  CurrencySchema,
  IsoDateSchema,
  LanguageSchema,
  LlmAnalysisSchema,
  llmAnalysisJsonSchema,
  type AnalysisResult,
} from './schema';

/** Returns a fresh copy so each test can mutate it freely. */
function makeResult(): AnalysisResult {
  return {
    document: {
      fileName: 'faktura-2026-10.pdf',
      pages: 2,
      language: 'pl',
      type: 'invoice',
      title: 'Faktura VAT nr 12/10/2026',
      date: '2026-10-01',
    },
    summary:
      'Faktura za usługi programistyczne wystawiona przez ACME Sp. z o.o. Termin płatności to 15 października 2026.',
    keyPoints: [
      'Usługi programistyczne za wrzesień',
      'Termin płatności: 14 dni',
      'Płatność przelewem',
    ],
    entities: {
      organizations: ['ACME Sp. z o.o.'],
      people: ['Jan Kowalski'],
    },
    amounts: [{ value: 12300.5, currency: 'PLN', context: 'Kwota brutto' }],
    dates: [{ date: '2026-10-15', context: 'Termin płatności' }],
    keywords: ['faktura', 'usługi IT'],
  };
}

const validResult = makeResult();

function withoutKey(object: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));
}

describe('AnalysisResultSchema', () => {
  it('accepts a valid full result', () => {
    expect(AnalysisResultSchema.parse(validResult)).toEqual(validResult);
  });

  it('accepts nulls and empty arrays for missing information', () => {
    const result = makeResult();
    result.document.title = null;
    result.document.date = null;
    result.entities = { organizations: [], people: [] };
    result.amounts = [];
    result.dates = [];
    result.keywords = [];

    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
  });

  it.each(['summary', 'keyPoints', 'entities', 'amounts', 'dates', 'keywords', 'document'])(
    'rejects a result missing top-level field "%s"',
    (field) => {
      const result = withoutKey(makeResult(), field);

      expect(AnalysisResultSchema.safeParse(result).success).toBe(false);
    },
  );

  it.each(['fileName', 'pages', 'language', 'type', 'title', 'date'])(
    'rejects a result missing document field "%s"',
    (field) => {
      const result = makeResult();
      const document = withoutKey(result.document, field);

      expect(AnalysisResultSchema.safeParse({ ...result, document }).success).toBe(false);
    },
  );

  it('rejects an empty summary', () => {
    const result = { ...makeResult(), summary: '   ' };
    expect(AnalysisResultSchema.safeParse(result).success).toBe(false);
  });

  it('rejects an unknown document type', () => {
    const result = makeResult();
    const document = { ...result.document, type: 'letter' };
    expect(AnalysisResultSchema.safeParse({ ...result, document }).success).toBe(false);
  });

  it('accepts 1 key point and rejects 0 or more than 7', () => {
    const result = makeResult();
    expect(AnalysisResultSchema.safeParse({ ...result, keyPoints: ['Jeden'] }).success).toBe(true);
    expect(AnalysisResultSchema.safeParse({ ...result, keyPoints: [] }).success).toBe(false);

    const eight = Array.from({ length: 8 }, (_, i) => `Punkt ${String(i + 1)}`);
    expect(AnalysisResultSchema.safeParse({ ...result, keyPoints: eight }).success).toBe(false);
  });

  it('rejects non-finite amount values', () => {
    const result = makeResult();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const amounts = [{ value, currency: 'PLN', context: 'Kwota' }];
      expect(AnalysisResultSchema.safeParse({ ...result, amounts }).success).toBe(false);
    }
  });

  it('rejects invalid page counts', () => {
    const result = makeResult();
    for (const pages of [0, -1, 1.5]) {
      const document = { ...result.document, pages };
      expect(AnalysisResultSchema.safeParse({ ...result, document }).success).toBe(false);
    }
  });

  it('rejects invalid dates inside the dates array', () => {
    const result = makeResult();
    const dates = [{ date: '15.10.2026', context: 'Termin płatności' }];
    expect(AnalysisResultSchema.safeParse({ ...result, dates }).success).toBe(false);
  });

  it('strips unknown fields instead of rejecting them', () => {
    const input = {
      ...makeResult(),
      confidence: 0.9,
      document: { ...validResult.document, author: 'Model' },
    };

    const parsed = AnalysisResultSchema.parse(input);

    expect(parsed).toEqual(validResult);
    expect(parsed).not.toHaveProperty('confidence');
    expect(parsed.document).not.toHaveProperty('author');
  });
});

describe('LlmAnalysisSchema', () => {
  it('accepts a result without fileName and pages', () => {
    const document = withoutKey(withoutKey(validResult.document, 'fileName'), 'pages');
    expect(LlmAnalysisSchema.safeParse({ ...validResult, document }).success).toBe(true);
  });

  it('strips fileName and pages if the model returns them', () => {
    const parsed = LlmAnalysisSchema.parse(validResult);
    expect(parsed.document).not.toHaveProperty('fileName');
    expect(parsed.document).not.toHaveProperty('pages');
  });

  it('exports a JSON Schema without fileName and pages', () => {
    const documentSchema: unknown = llmAnalysisJsonSchema.properties?.['document'];
    expect(documentSchema).toMatchObject({
      type: 'object',
      required: ['language', 'type', 'title', 'date'],
    });
    expect(documentSchema).not.toHaveProperty('properties.fileName');
    expect(documentSchema).not.toHaveProperty('properties.pages');
  });
});

describe('IsoDateSchema', () => {
  it.each(['2026-10-08', '2024-02-29', '2026-12-31'])('accepts %s', (date) => {
    expect(IsoDateSchema.safeParse(date).success).toBe(true);
  });

  it.each([
    '2026-13-01',
    '01.10.2026',
    '2026-02-30',
    '2025-02-29',
    '2026-04-31',
    '2026-1-1',
    '2026-10-08T12:00:00Z',
    '',
  ])('rejects %s', (date) => {
    expect(IsoDateSchema.safeParse(date).success).toBe(false);
  });
});

describe('CurrencySchema', () => {
  it.each(['PLN', 'EUR', 'USD'])('accepts %s', (currency) => {
    expect(CurrencySchema.safeParse(currency).success).toBe(true);
  });

  it.each(['zł', 'pln', 'PL', 'PLNX', '€'])('rejects %s', (currency) => {
    expect(CurrencySchema.safeParse(currency).success).toBe(false);
  });
});

describe('LanguageSchema', () => {
  it.each(['pl', 'en', 'de'])('accepts %s', (language) => {
    expect(LanguageSchema.safeParse(language).success).toBe(true);
  });

  it.each(['pol', 'PL', 'p', 'pl-PL', ''])('rejects %s', (language) => {
    expect(LanguageSchema.safeParse(language).success).toBe(false);
  });
});
