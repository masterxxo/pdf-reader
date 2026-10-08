import type { RequestMetrics } from './lib/metrics';

export interface Env {
  /** Mistral, the primary provider. */
  MISTRAL_API_KEY: string;
  MISTRAL_MODEL: string;
  /** Gemini, the fallback provider (names kept from when it was the only one). */
  LLM_API_KEY: string;
  LLM_MODEL: string;
  /** Comma-separated list of exact origins allowed by CORS. */
  ALLOWED_ORIGINS: string;
  /** Long documents (see parseLongDocumentConfig); wrangler vars are strings. */
  SINGLE_CALL_MAX_TOKENS?: string;
  MAX_CHUNKS?: string;
  CHUNK_CONCURRENCY?: string;
  ANALYZE_RATE_LIMITER: RateLimit;
  /** Analysis results keyed by a hash of the prompt and text (see lib/cache.ts). */
  ANALYSIS_CACHE: KVNamespace;
  /** Set to "1" (only in .dev.vars) to log request timings and LLM attempts. */
  DEBUG?: string;
}

export type AppEnv = { Bindings: Env; Variables: { metrics: RequestMetrics } };
