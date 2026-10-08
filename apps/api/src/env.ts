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
  /** Maximum length of the document text, as a string (wrangler vars are strings). */
  MAX_TEXT_CHARS: string;
  ANALYZE_RATE_LIMITER: RateLimit;
  /** Analysis results keyed by a hash of the prompt and text (see lib/cache.ts). */
  ANALYSIS_CACHE: KVNamespace;
  /** Set to "1" (only in .dev.vars) to log request timings and LLM attempts. */
  DEBUG?: string;
}

export type AppEnv = { Bindings: Env; Variables: { metrics: RequestMetrics } };
