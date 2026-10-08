import { AnalysisResultSchema, type AnalysisResult } from '@pdf-insight/shared';

/** Versioned, so a future change to the entry shape can start from a clean key. */
export const HISTORY_STORAGE_KEY = 'pdf-insight:history:v1';
export const MAX_HISTORY_ENTRIES = 10;

export interface HistoryEntry {
  id: string;
  fileName: string;
  /** ISO 8601 timestamp of when the analysis finished. */
  analyzedAt: string;
  result: AnalysisResult;
}

export type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SaveOptions {
  storage?: HistoryStorage | null;
  now?: Date;
  createId?: () => string;
}

/** Even reading `window.localStorage` can throw (e.g. storage disabled by the browser). */
function getLocalStorage(): HistoryStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function createDefaultId(): string {
  // randomUUID exists only in secure contexts; GitHub Pages and localhost are.
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Returns a valid entry, or null for anything stored by an older or tampered version. */
function parseEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null;
  const { id, fileName, analyzedAt } = value;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof fileName !== 'string' || fileName.length === 0) return null;
  if (typeof analyzedAt !== 'string' || Number.isNaN(Date.parse(analyzedAt))) return null;
  const result = AnalysisResultSchema.safeParse(value.result);
  return result.success ? { id, fileName, analyzedAt, result: result.data } : null;
}

/** Newest first. Never throws: unavailable or corrupted storage reads as empty history. */
export function readHistory(storage: HistoryStorage | null = getLocalStorage()): HistoryEntry[] {
  if (!storage) return [];
  let parsed: unknown;
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (raw === null) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(parseEntry)
    .filter((entry): entry is HistoryEntry => entry !== null)
    .slice(0, MAX_HISTORY_ENTRIES);
}

function writeHistory(entries: HistoryEntry[], storage: HistoryStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage disabled: the app keeps working without history.
  }
}

function isSameDocument(entry: HistoryEntry, result: AnalysisResult): boolean {
  return entry.fileName === result.document.fileName && entry.result.summary === result.summary;
}

/**
 * Adds a successful analysis at the top and returns the new history. The same
 * document (same file name and summary) replaces its older entry.
 */
export function saveToHistory(
  result: AnalysisResult,
  { storage = getLocalStorage(), now = new Date(), createId = createDefaultId }: SaveOptions = {},
): HistoryEntry[] {
  const entry: HistoryEntry = {
    id: createId(),
    fileName: result.document.fileName,
    analyzedAt: now.toISOString(),
    result,
  };
  const entries = [
    entry,
    ...readHistory(storage).filter((existing) => !isSameDocument(existing, result)),
  ].slice(0, MAX_HISTORY_ENTRIES);
  writeHistory(entries, storage);
  return entries;
}

export function removeFromHistory(
  id: string,
  storage: HistoryStorage | null = getLocalStorage(),
): HistoryEntry[] {
  const entries = readHistory(storage).filter((entry) => entry.id !== id);
  writeHistory(entries, storage);
  return entries;
}

export function clearHistory(storage: HistoryStorage | null = getLocalStorage()): void {
  try {
    storage?.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}
