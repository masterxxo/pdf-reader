import type { ApiErrorCode } from '@pdf-insight/shared';

/** API error codes plus failures that only happen on the client. */
export type AnalysisErrorCode =
  | ApiErrorCode
  | 'NETWORK_ERROR'
  | 'CLIENT_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'MISSING_API_URL'
  | 'UNKNOWN';

const ERROR_MESSAGES: Record<AnalysisErrorCode, string> = {
  INVALID_REQUEST: 'Nie udało się wysłać dokumentu do analizy. Spróbuj z innym plikiem.',
  TEXT_TOO_LONG:
    'Dokument jest zbyt długi, aby go przeanalizować. Wybierz krótszy plik (obsługa długich dokumentów pojawi się wkrótce).',
  RATE_LIMITED: 'Przekroczono limit zapytań do usługi analizy. Odczekaj minutę i spróbuj ponownie.',
  LLM_TIMEOUT: 'Analiza trwała zbyt długo. Spróbuj ponownie.',
  LLM_UNAVAILABLE: 'Usługa analizy AI jest chwilowo niedostępna. Spróbuj ponownie za chwilę.',
  LLM_INVALID_OUTPUT: 'Model AI zwrócił nieprawidłową odpowiedź. Spróbuj ponownie.',
  NOT_FOUND: 'Usługa analizy jest nieosiągalna. Spróbuj ponownie później.',
  INTERNAL: 'Wystąpił błąd serwera podczas analizy. Spróbuj ponownie później.',
  NETWORK_ERROR:
    'Brak połączenia z usługą analizy. Sprawdź połączenie z internetem i spróbuj ponownie.',
  CLIENT_TIMEOUT: 'Serwer nie odpowiedział na czas. Spróbuj ponownie.',
  INVALID_RESPONSE: 'Otrzymano nieprawidłowy wynik analizy. Spróbuj ponownie.',
  MISSING_API_URL: 'Aplikacja nie jest poprawnie skonfigurowana (brak adresu API).',
  UNKNOWN: 'Wystąpił nieoczekiwany błąd podczas analizy. Spróbuj ponownie.',
};

/** Retrying with the same text cannot help for these. */
const NON_RETRYABLE_CODES: ReadonlySet<AnalysisErrorCode> = new Set([
  'INVALID_REQUEST',
  'TEXT_TOO_LONG',
  'MISSING_API_URL',
]);

export function getAnalysisErrorMessage(code: AnalysisErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function isRetryableError(code: AnalysisErrorCode): boolean {
  return !NON_RETRYABLE_CODES.has(code);
}

/** Fallback when an error response has no recognizable body (e.g. a proxy error page). */
export function errorCodeFromStatus(status: number): AnalysisErrorCode {
  switch (status) {
    case 400:
      return 'INVALID_REQUEST';
    case 413:
      return 'TEXT_TOO_LONG';
    case 429:
      return 'RATE_LIMITED';
    case 504:
      return 'LLM_TIMEOUT';
    case 502:
    case 503:
      return 'LLM_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL' : 'UNKNOWN';
  }
}

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;

  constructor(code: AnalysisErrorCode, options?: { cause?: unknown }) {
    super(getAnalysisErrorMessage(code), options);
    this.name = 'AnalysisError';
    this.code = code;
  }
}
