import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'TEXT_TOO_LONG'
  | 'RATE_LIMITED'
  | 'LLM_TIMEOUT'
  | 'LLM_UNAVAILABLE'
  | 'LLM_INVALID_OUTPUT'
  | 'NOT_FOUND'
  | 'INTERNAL';

const ERRORS: Record<ErrorCode, { status: ContentfulStatusCode; message: string }> = {
  INVALID_REQUEST: { status: 400, message: 'Nieprawidłowe żądanie.' },
  TEXT_TOO_LONG: {
    status: 413,
    message: 'Dokument jest zbyt długi, aby go przeanalizować.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Zbyt wiele żądań. Odczekaj chwilę i spróbuj ponownie.',
  },
  LLM_TIMEOUT: {
    status: 504,
    message: 'Analiza trwała zbyt długo. Spróbuj ponownie.',
  },
  LLM_UNAVAILABLE: {
    status: 502,
    message: 'Usługa analizy AI jest chwilowo niedostępna. Spróbuj ponownie później.',
  },
  LLM_INVALID_OUTPUT: {
    status: 502,
    message: 'Model AI zwrócił nieprawidłową odpowiedź. Spróbuj ponownie.',
  },
  NOT_FOUND: { status: 404, message: 'Nie znaleziono zasobu.' },
  INTERNAL: { status: 500, message: 'Wystąpił nieoczekiwany błąd serwera.' },
};

/** An error that maps to a known API error response. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;

  constructor(code: ErrorCode, options?: { message?: string; cause?: unknown }) {
    const { status, message } = ERRORS[code];
    super(options?.message ?? message, { cause: options?.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export function toErrorBody(error: ApiError): ErrorBody {
  return { error: { code: error.code, message: error.message } };
}
