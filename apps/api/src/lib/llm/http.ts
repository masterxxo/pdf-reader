import { LlmProviderError } from './types';

export interface PostJsonOptions {
  /** Provider name, used only in error causes. */
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  fetch: typeof fetch;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** Parses Retry-After (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? seconds * 1000 : undefined;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function transportError(error: unknown, callerSignal: AbortSignal | undefined): LlmProviderError {
  return new LlmProviderError(isAbortError(error) ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE', {
    // An abort by the caller means nobody waits for the result any more.
    canFallback: callerSignal?.aborted !== true,
    cause: error,
  });
}

/**
 * POSTs a JSON body to an LLM API and returns the parsed JSON response.
 * Upstream bodies may echo request details, so they are never passed on.
 */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const { provider, url, headers, body, timeoutMs, signal, fetch: fetchImpl } = options;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
  } catch (error) {
    throw transportError(error, signal);
  }

  // Quota exceeded (free tiers allow only a few requests per second or minute).
  if (response.status === 429) {
    throw new LlmProviderError('RATE_LIMITED', {
      canFallback: true,
      retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
      cause: new Error(`${provider} responded with HTTP 429`),
    });
  }

  if (!response.ok) {
    throw new LlmProviderError('LLM_UNAVAILABLE', {
      // Other 4xx errors mean a bad request or configuration, not an outage.
      canFallback: response.status >= 500,
      cause: new Error(`${provider} responded with HTTP ${String(response.status)}`),
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw transportError(error, signal);
  }
}
