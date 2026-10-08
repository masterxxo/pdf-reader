import { MAX_FILE_SIZE_BYTES } from '@pdf-insight/shared';
import { describe, expect, it } from 'vitest';
import { validateFile } from './validateFile';

const PDF_HEADER = '%PDF-1.7\n';

function makeFile(content: string, name = 'dokument.pdf', type = 'application/pdf'): File {
  return new File([content], name, { type });
}

/** A file of the given size that starts with a valid PDF header. */
function makeSizedPdf(size: number): File {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode(PDF_HEADER));
  return new File([bytes], 'duzy.pdf', { type: 'application/pdf' });
}

describe('validateFile', () => {
  it('accepts a valid PDF', async () => {
    await expect(validateFile(makeFile(PDF_HEADER))).resolves.toEqual({ ok: true });
  });

  it('accepts a .pdf file with an empty MIME type', async () => {
    await expect(validateFile(makeFile(PDF_HEADER, 'Skan.PDF', ''))).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects a non-PDF MIME type and extension', async () => {
    const result = await validateFile(makeFile('hello', 'notatki.txt', 'text/plain'));
    expect(result).toMatchObject({ ok: false, code: 'invalid-type' });
  });

  it('rejects an empty file', async () => {
    const result = await validateFile(makeFile(''));
    expect(result).toMatchObject({ ok: false, code: 'empty' });
  });

  it('accepts a file of exactly 10 MB', async () => {
    await expect(validateFile(makeSizedPdf(MAX_FILE_SIZE_BYTES))).resolves.toEqual({ ok: true });
  });

  it('rejects a file larger than 10 MB', async () => {
    const result = await validateFile(makeSizedPdf(MAX_FILE_SIZE_BYTES + 1));
    expect(result).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('rejects a file without the %PDF- signature', async () => {
    const result = await validateFile(makeFile('<html>to nie jest PDF</html>'));
    expect(result).toMatchObject({ ok: false, code: 'invalid-signature' });
  });

  it('rejects a file shorter than the signature', async () => {
    const result = await validateFile(makeFile('%PD'));
    expect(result).toMatchObject({ ok: false, code: 'invalid-signature' });
  });

  it('returns a Polish error message', async () => {
    const result = await validateFile(makeFile('hello', 'notatki.txt', 'text/plain'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Nieobsługiwany format pliku. Wybierz plik PDF.');
    }
  });
});
