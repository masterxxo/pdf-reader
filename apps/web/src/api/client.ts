import {
  AnalysisResultSchema,
  ApiErrorResponseSchema,
  type AnalysisResult,
  type AnalyzeRequest,
} from '@pdf-insight/shared';
import { AnalysisError, errorCodeFromStatus } from './errors';

/** Longer than the server's whole time budget (27 s for all model calls) plus the network. */
export const CLIENT_TIMEOUT_MS = 40_000;

export interface AnalyzeOptions {
  signal?: AbortSignal;
  /** Defaults to VITE_API_URL. */
  apiUrl?: string;
  timeoutMs?: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Sends extracted text to the API and returns a validated analysis.
 * Throws AnalysisError on failure; rethrows the AbortError if `signal` aborts.
 */
export async function analyzeDocument(
  request: AnalyzeRequest,
  {
    signal,
    apiUrl = import.meta.env.VITE_API_URL,
    timeoutMs = CLIENT_TIMEOUT_MS,
  }: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const baseUrl = apiUrl?.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new AnalysisError('MISSING_API_URL');
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
  } catch (error) {
    if (signal?.aborted && isAbortError(error)) {
      throw error;
    }
    if (timeoutSignal.aborted) {
      throw new AnalysisError('CLIENT_TIMEOUT', { cause: error });
    }
    throw new AnalysisError('NETWORK_ERROR', { cause: error });
  }

  const body = await readJson(response);

  if (!response.ok) {
    const apiError = ApiErrorResponseSchema.safeParse(body);
    const code = apiError.success ? apiError.data.error.code : errorCodeFromStatus(response.status);
    throw new AnalysisError(code);
  }

  // The brief requires validating the result again before it is displayed.
  const result = AnalysisResultSchema.safeParse(body);
  if (!result.success) {
    throw new AnalysisError('INVALID_RESPONSE', { cause: result.error });
  }
  return result.data;
}
