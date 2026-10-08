export interface Env {
  LLM_API_KEY: string;
  LLM_MODEL: string;
  /** Comma-separated list of exact origins allowed by CORS. */
  ALLOWED_ORIGINS: string;
  /** Maximum length of the document text, as a string (wrangler vars are strings). */
  MAX_TEXT_CHARS: string;
  ANALYZE_RATE_LIMITER: RateLimit;
}

export type AppEnv = { Bindings: Env };
