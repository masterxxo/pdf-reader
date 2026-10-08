import { ACCEPTED_MIME_TYPE, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@pdf-insight/shared';

export type FileValidationErrorCode = 'invalid-type' | 'empty' | 'too-large' | 'invalid-signature';

export type FileValidationResult =
  { ok: true } | { ok: false; code: FileValidationErrorCode; message: string };

const ERROR_MESSAGES: Record<FileValidationErrorCode, string> = {
  'invalid-type': 'Nieobsługiwany format pliku. Wybierz plik PDF.',
  empty: 'Wybrany plik jest pusty.',
  'too-large': `Plik jest za duży. Maksymalny rozmiar to ${String(MAX_FILE_SIZE_MB)} MB.`,
  'invalid-signature': 'Plik nie jest prawidłowym dokumentem PDF.',
};

/** Every PDF file starts with these bytes. */
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function fail(code: FileValidationErrorCode): FileValidationResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

function hasPdfMimeTypeOrExtension(file: File): boolean {
  // Some browsers/OSes report an empty MIME type, so the extension is a fallback.
  // The magic bytes check below is the authoritative one.
  return file.type === ACCEPTED_MIME_TYPE || file.name.toLowerCase().endsWith('.pdf');
}

async function hasPdfSignature(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES.length).arrayBuffer());
  return PDF_MAGIC_BYTES.every((byte, index) => header[index] === byte);
}

export async function validateFile(file: File): Promise<FileValidationResult> {
  if (!hasPdfMimeTypeOrExtension(file)) {
    return fail('invalid-type');
  }
  if (file.size === 0) {
    return fail('empty');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail('too-large');
  }
  if (!(await hasPdfSignature(file))) {
    return fail('invalid-signature');
  }
  return { ok: true };
}
