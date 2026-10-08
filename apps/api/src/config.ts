import type { LongDocumentConfig } from './lib/analyze';

/**
 * Measured with ministral-8b-2512 on the free Mistral plan: one call takes
 * ~18–25 s for 20k–100k input tokens (output generation dominates), while
 * map-reduce over 2 chunks cannot finish in the 27 s budget (parallel calls
 * are throttled; two sequential maps plus the reduce take ~30 s). So by
 * default a document is analyzed in one call up to ~50k tokens (~135k
 * characters) and longer ones are rejected upfront. MAX_CHUNKS=2 enables
 * the chunked path where the provider allows real parallel calls.
 */
export const DEFAULT_LONG_DOCUMENT_CONFIG: LongDocumentConfig = {
  singleCallMaxTokens: 50_000,
  maxChunks: 1,
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
