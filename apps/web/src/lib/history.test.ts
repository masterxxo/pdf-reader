import type { AnalysisResult } from '@pdf-insight/shared';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_ENTRIES,
  clearHistory,
  readHistory,
  removeFromHistory,
  saveToHistory,
  type HistoryStorage,
} from './history';

class MemoryStorage implements HistoryStorage {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** Behaves like storage in private mode or with an exceeded quota. */
const throwingStorage: HistoryStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

function makeResult(fileName = 'faktura.pdf', summary = 'Faktura za usługi.'): AnalysisResult {
  return {
    document: {
      fileName,
      pages: 1,
      language: 'pl',
      type: 'invoice',
      title: null,
      date: null,
    },
    summary,
    keyPoints: ['Punkt'],
    entities: { organizations: [], people: [] },
    amounts: [],
    dates: [],
    keywords: [],
  };
}

function sequentialIds() {
  let next = 0;
  return () => `id-${++next}`;
}

describe('history', () => {
  it('saves an analysis and reads it back', () => {
    const storage = new MemoryStorage();
    const result = makeResult();
    const now = new Date('2026-10-08T12:00:00.000Z');

    const saved = saveToHistory(result, { storage, now, createId: () => 'a' });

    const expected = [
      { id: 'a', fileName: 'faktura.pdf', analyzedAt: '2026-10-08T12:00:00.000Z', result },
    ];
    expect(saved).toEqual(expected);
    expect(readHistory(storage)).toEqual(expected);
  });

  it('returns an empty list when nothing is stored', () => {
    expect(readHistory(new MemoryStorage())).toEqual([]);
    expect(readHistory(null)).toEqual([]);
  });

  it('keeps the newest entries first, at most MAX_HISTORY_ENTRIES', () => {
    const storage = new MemoryStorage();
    const createId = sequentialIds();
    for (let index = 1; index <= MAX_HISTORY_ENTRIES + 2; index++) {
      saveToHistory(makeResult(`plik-${index}.pdf`), { storage, createId });
    }

    const entries = readHistory(storage);
    expect(entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(entries[0]?.fileName).toBe(`plik-${MAX_HISTORY_ENTRIES + 2}.pdf`);
    expect(entries.at(-1)?.fileName).toBe('plik-3.pdf');
  });

  it('replaces an older entry of the same document instead of duplicating it', () => {
    const storage = new MemoryStorage();
    const createId = sequentialIds();
    saveToHistory(makeResult('a.pdf'), { storage, createId });
    saveToHistory(makeResult('b.pdf'), { storage, createId });
    saveToHistory(makeResult('a.pdf'), { storage, createId });

    expect(readHistory(storage).map((entry) => [entry.id, entry.fileName])).toEqual([
      ['id-3', 'a.pdf'],
      ['id-2', 'b.pdf'],
    ]);
  });

  it('keeps entries with the same file name but a different summary', () => {
    const storage = new MemoryStorage();
    saveToHistory(makeResult('a.pdf', 'Pierwsza wersja.'), { storage });
    saveToHistory(makeResult('a.pdf', 'Druga wersja.'), { storage });

    expect(readHistory(storage)).toHaveLength(2);
  });

  it('silently drops invalid entries', () => {
    const storage = new MemoryStorage();
    const valid = {
      id: 'ok',
      fileName: 'faktura.pdf',
      analyzedAt: '2026-10-08T12:00:00.000Z',
      result: makeResult(),
    };
    const invalidResult = makeResult();
    Reflect.deleteProperty(invalidResult, 'summary');
    storage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([
        valid,
        { ...valid, id: 'no-summary', result: invalidResult },
        {
          ...valid,
          id: 'bad-currency',
          result: { ...makeResult(), amounts: [{ value: 1, currency: 'zł', context: '' }] },
        },
        { ...valid, id: '' },
        { ...valid, id: 'bad-date', analyzedAt: 'wczoraj' },
        { ...valid, id: 'no-file-name', fileName: undefined },
        null,
        'tekst',
      ]),
    );

    expect(readHistory(storage).map((entry) => entry.id)).toEqual(['ok']);
  });

  it('reads malformed storage content as empty history', () => {
    const storage = new MemoryStorage();
    storage.setItem(HISTORY_STORAGE_KEY, '{not json');
    expect(readHistory(storage)).toEqual([]);

    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ entries: [] }));
    expect(readHistory(storage)).toEqual([]);
  });

  it('removes a single entry', () => {
    const storage = new MemoryStorage();
    const createId = sequentialIds();
    saveToHistory(makeResult('a.pdf'), { storage, createId });
    saveToHistory(makeResult('b.pdf'), { storage, createId });

    expect(removeFromHistory('id-1', storage).map((entry) => entry.id)).toEqual(['id-2']);
    expect(readHistory(storage).map((entry) => entry.id)).toEqual(['id-2']);
  });

  it('clears the whole history', () => {
    const storage = new MemoryStorage();
    saveToHistory(makeResult(), { storage });

    clearHistory(storage);

    expect(storage.items.has(HISTORY_STORAGE_KEY)).toBe(false);
    expect(readHistory(storage)).toEqual([]);
  });

  it('keeps working when storage throws', () => {
    const result = makeResult();

    expect(readHistory(throwingStorage)).toEqual([]);
    expect(() => clearHistory(throwingStorage)).not.toThrow();
    expect(removeFromHistory('x', throwingStorage)).toEqual([]);
    // The analysis is still returned, so it can be shown for the current session.
    expect(saveToHistory(result, { storage: throwingStorage, createId: () => 'a' })).toEqual([
      expect.objectContaining({ id: 'a', result }),
    ]);
  });

  it('works without any storage (e.g. outside the browser)', () => {
    expect(saveToHistory(makeResult(), { storage: null })).toHaveLength(1);
    expect(() => clearHistory(null)).not.toThrow();
  });
});
