// Response metadata is sent in headers, so the body holds only schema fields.

/** Which LLM provider produced the result. */
export const PROVIDER_HEADER = 'X-LLM-Provider';

/** Whether the result came from the analysis cache: HIT or MISS. */
export const CACHE_HEADER = 'X-Cache';

/** Request timings and LLM attempts (see lib/metrics.ts); no document content. */
export const SERVER_TIMING_HEADER = 'Server-Timing';

/** Response headers readable by the web app (CORS exposeHeaders). */
export const EXPOSED_HEADERS = [PROVIDER_HEADER, CACHE_HEADER];
