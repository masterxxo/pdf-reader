import { LIST_LIMITS } from '@pdf-insight/shared';
import { describe, expect, it } from 'vitest';
import { mergeLists, mergePartials, nameKey, roundRobin, type MergeableLists } from './merge';

function partial(overrides: Partial<MergeableLists> = {}): MergeableLists {
  return { entities: { organizations: [], people: [] }, amounts: [], dates: [], ...overrides };
}

describe('nameKey', () => {
  it('ignores case, extra spaces and trailing punctuation', () => {
    expect(nameKey('ACME  Sp. z o.o.')).toBe(nameKey('acme sp. z o.o'));
    expect(nameKey('Łukasz Żak,')).toBe('łukasz żak');
  });
});

describe('roundRobin', () => {
  it('interleaves lists of different lengths', () => {
    expect(roundRobin([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'c2',
      'a3',
    ]);
  });

  it('handles no lists', () => {
    expect(roundRobin([])).toEqual([]);
  });
});

describe('mergeLists', () => {
  it('keeps the first of duplicates and cuts to the limit', () => {
    const merged = mergeLists(
      [
        ['A', 'B', 'C'],
        ['a', 'D'],
      ],
      (s) => s.toLowerCase(),
      3,
    );
    expect(merged).toEqual(['A', 'B', 'D']);
  });

  it('skips items with an empty key', () => {
    expect(mergeLists([['', ' ', 'X']], (s) => s.trim(), 5)).toEqual(['X']);
  });
});

describe('mergePartials', () => {
  it('dedupes entities across chunks and keeps every chunk represented', () => {
    const first = partial({
      entities: { organizations: ['ACME S.A.', 'Beta Sp. z o.o.'], people: ['Jan Kowalski'] },
    });
    const second = partial({
      entities: {
        organizations: ['acme s.a.', 'Gamma S.A.'],
        people: ['Anna Nowak', 'Jan  Kowalski'],
      },
    });

    expect(mergePartials([first, second]).entities).toEqual({
      organizations: ['ACME S.A.', 'Beta Sp. z o.o.', 'Gamma S.A.'],
      people: ['Jan Kowalski', 'Anna Nowak'],
    });
  });

  it('dedupes amounts by value and currency, keeping the first context', () => {
    const first = partial({
      amounts: [
        { value: 12500, currency: 'PLN', context: 'Wartość umowy' },
        { value: 100, currency: 'EUR', context: 'Opłata' },
      ],
    });
    const second = partial({
      amounts: [
        { value: 12500, currency: 'PLN', context: 'Cena łączna' },
        { value: 12500, currency: 'EUR', context: 'Inna waluta' },
      ],
    });

    // Interleaved: 1st of each chunk (the 2nd chunk's is a duplicate), then 2nd of each.
    expect(mergePartials([first, second]).amounts).toEqual([
      { value: 12500, currency: 'PLN', context: 'Wartość umowy' },
      { value: 100, currency: 'EUR', context: 'Opłata' },
      { value: 12500, currency: 'EUR', context: 'Inna waluta' },
    ]);
  });

  it('dedupes dates, keeping the first context', () => {
    const first = partial({ dates: [{ date: '2026-01-15', context: 'Podpisanie umowy' }] });
    const second = partial({
      dates: [
        { date: '2026-01-15', context: 'Zawarcie umowy' },
        { date: '2026-03-01', context: 'Termin płatności' },
      ],
    });

    expect(mergePartials([first, second]).dates).toEqual([
      { date: '2026-01-15', context: 'Podpisanie umowy' },
      { date: '2026-03-01', context: 'Termin płatności' },
    ]);
  });

  it('cuts merged lists to the final limits', () => {
    const names = (prefix: string) =>
      Array.from({ length: 12 }, (_, i) => `${prefix} ${String(i)}`);
    const merged = mergePartials([
      partial({ entities: { organizations: names('Firma A'), people: names('Osoba A') } }),
      partial({ entities: { organizations: names('Firma B'), people: names('Osoba B') } }),
    ]);

    expect(merged.entities.organizations).toHaveLength(LIST_LIMITS.organizations);
    expect(merged.entities.people).toHaveLength(LIST_LIMITS.people);
    // Interleaved, so both chunks' most important names are kept.
    expect(merged.entities.organizations.slice(0, 2)).toEqual(['Firma A 0', 'Firma B 0']);
  });

  it('returns empty lists for chunks without data', () => {
    expect(mergePartials([partial(), partial()])).toEqual(partial());
  });
});
