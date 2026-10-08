// Response metadata is sent in headers, so the body holds only schema fields.

/** Which LLM provider produced the result. */
export const PROVIDER_HEADER = 'X-LLM-Provider';

/** Response headers readable by the web app (CORS exposeHeaders). */
export const EXPOSED_HEADERS = [PROVIDER_HEADER];
