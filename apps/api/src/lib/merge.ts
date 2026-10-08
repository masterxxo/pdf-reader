import { LIST_LIMITS, type LlmAnalysis } from '@pdf-insight/shared';

/** The lists that partial results of a long document's chunks contribute. */
export type MergeableLists = Pick<LlmAnalysis, 'entities' | 'amounts' | 'dates'>;

/** "ACME  Sp. z o.o." and "acme sp. z o.o" are the same name. */
export function nameKey(name: string): string {
  return name
    .toLocaleLowerCase('pl')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:"'„”]+$/, '')
    .trim();
}

/**
 * Interleaves lists: the 1st item of every list, then the 2nd of every list,
 * and so on. Each chunk lists its most important items first, so every chunk
 * is represented when the merged list is cut to its limit.
 */
export function roundRobin<T>(lists: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index++) {
    for (const list of lists) {
      const item = list[index];
      if (item !== undefined) {
        result.push(item);
      }
    }
  }
  return result;
}

/** Interleaves, removes duplicates by key (keeping the first) and cuts to the limit. */
export function mergeLists<T>(
  lists: readonly (readonly T[])[],
  key: (item: T) => string,
  limit: number,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of roundRobin(lists)) {
    const itemKey = key(item);
    if (itemKey === '' || seen.has(itemKey)) {
      continue;
    }
    seen.add(itemKey);
    result.push(item);
    if (result.length === limit) {
      break;
    }
  }
  return result;
}

/**
 * Merges entities, amounts and dates of the chunks of one document. The same
 * amount (value and currency) or date found in two chunks is kept once, with
 * the context of its first occurrence. Pure.
 */
export function mergePartials(partials: readonly MergeableLists[]): MergeableLists {
  return {
    entities: {
      organizations: mergeLists(
        partials.map((partial) => partial.entities.organizations),
        nameKey,
        LIST_LIMITS.organizations,
      ),
      people: mergeLists(
        partials.map((partial) => partial.entities.people),
        nameKey,
        LIST_LIMITS.people,
      ),
    },
    amounts: mergeLists(
      partials.map((partial) => partial.amounts),
      (amount) => `${String(amount.value)} ${amount.currency}`,
      LIST_LIMITS.amounts,
    ),
    dates: mergeLists(
      partials.map((partial) => partial.dates),
      (date) => date.date,
      LIST_LIMITS.dates,
    ),
  };
}
