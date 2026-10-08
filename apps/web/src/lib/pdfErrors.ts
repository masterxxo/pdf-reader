export type PdfErrorCode = 'password-protected' | 'corrupted' | 'no-text-layer' | 'unknown';

const ERROR_MESSAGES: Record<PdfErrorCode, string> = {
  'password-protected':
    'Ten plik PDF jest chroniony hasłem. Usuń zabezpieczenie i spróbuj ponownie.',
  corrupted: 'Nie udało się odczytać pliku. Plik PDF może być uszkodzony.',
  'no-text-layer':
    'Ten dokument nie zawiera warstwy tekstowej (prawdopodobnie jest to skan). Skanowane dokumenty nie są obsługiwane.',
  unknown: 'Wystąpił nieoczekiwany błąd podczas odczytywania pliku PDF.',
};

export class PdfExtractionError extends Error {
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, options?: { cause?: unknown }) {
    super(ERROR_MESSAGES[code], options);
    this.name = 'PdfExtractionError';
    this.code = code;
  }
}

/** Maps anything thrown while reading a PDF to a typed error with a user-facing message. */
export function toPdfExtractionError(error: unknown): PdfExtractionError {
  if (error instanceof PdfExtractionError) {
    return error;
  }
  // pdf.js exceptions are identified by name; instanceof would require the
  // lazily loaded module here.
  const name = error instanceof Error ? error.name : undefined;
  switch (name) {
    case 'PasswordException':
      return new PdfExtractionError('password-protected', { cause: error });
    case 'InvalidPDFException':
    case 'FormatError':
    case 'UnknownErrorException':
      return new PdfExtractionError('corrupted', { cause: error });
    default:
      return new PdfExtractionError('unknown', { cause: error });
  }
}
