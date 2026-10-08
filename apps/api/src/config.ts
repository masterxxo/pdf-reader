import type { LongDocumentConfig } from './lib/analyze';

export const DEFAULT_LONG_DOCUMENT_CONFIG: LongDocumentConfig = {
  singleCallMaxTokens: 60_000,
  maxChunks: 2,
  concurrency: 2,
};

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Long document settings from wrangler vars (strings); invalid or missing → defaults. */
export function parseLongDocumentConfig(env: {
  SINGLE_CALL_MAX_TOKENS?: string;
  MAX_CHUNKS?: string;
  CHUNK_CONCURRENCY?: string;
}): LongDocumentConfig {
  const defaults = DEFAULT_LONG_DOCUMENT_CONFIG;
  return {
    singleCallMaxTokens: parsePositiveInt(env.SINGLE_CALL_MAX_TOKENS, defaults.singleCallMaxTokens),
    maxChunks: parsePositiveInt(env.MAX_CHUNKS, defaults.maxChunks),
    concurrency: parsePositiveInt(env.CHUNK_CONCURRENCY, defaults.concurrency),
  };
}
