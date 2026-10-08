import type { ApiErrorCode, ApiErrorResponse } from '@pdf-insight/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const ERRORS: Record<ApiErrorCode, { status: ContentfulStatusCode; message: string }> = {
  INVALID_REQUEST: { status: 400, message: 'Nieprawidłowe żądanie.' },
  TEXT_TOO_LONG: {
    status: 413,
    message:
      'Dokument jest zbyt długi, aby przeanalizować go w limicie czasu. Prześlij krótszy dokument, np. wybrane strony.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Przekroczono limit zapytań. Odczekaj minutę i spróbuj ponownie.',
  },
  LLM_TIMEOUT: {
    status: 504,
    message:
      'Analiza nie zmieściła się w limicie czasu. Spróbuj ponownie za chwilę lub prześlij krótszy dokument.',
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
  readonly code: ApiErrorCode;
  readonly status: ContentfulStatusCode;

  constructor(code: ApiErrorCode, options?: { message?: string; cause?: unknown }) {
    const { status, message } = ERRORS[code];
    super(options?.message ?? message, { cause: options?.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function toErrorBody(error: ApiError): ApiErrorResponse {
  return { error: { code: error.code, message: error.message } };
}
