import { describe, expect, it } from 'vitest';
import { PdfExtractionError, toPdfExtractionError } from './pdfErrors';

function namedError(name: string): Error {
  const error = new Error('pdf.js error');
  error.name = name;
  return error;
}

describe('toPdfExtractionError', () => {
  it('maps PasswordException to password-protected', () => {
    expect(toPdfExtractionError(namedError('PasswordException')).code).toBe('password-protected');
  });

  it.each(['InvalidPDFException', 'FormatError', 'UnknownErrorException'])(
    'maps %s to corrupted',
    (name) => {
      expect(toPdfExtractionError(namedError(name)).code).toBe('corrupted');
    },
  );

  it('maps anything else to unknown and keeps the cause', () => {
    const cause = new TypeError('boom');
    const error = toPdfExtractionError(cause);
    expect(error.code).toBe('unknown');
    expect(error.cause).toBe(cause);
    expect(toPdfExtractionError('not an error').code).toBe('unknown');
  });

  it('passes PdfExtractionError through unchanged', () => {
    const original = new PdfExtractionError('no-text-layer');
    expect(toPdfExtractionError(original)).toBe(original);
  });

  it('uses Polish user-facing messages', () => {
    expect(new PdfExtractionError('no-text-layer').message).toContain(
      'Skanowane dokumenty nie są obsługiwane',
    );
  });
});
