import { describe, expect, it } from 'vitest';
import { ACCEPTED_MIME_TYPE, MAX_FILE_SIZE_BYTES } from './constants';

describe('upload constants', () => {
  it('accepts only PDF files up to 10 MB', () => {
    expect(ACCEPTED_MIME_TYPE).toBe('application/pdf');
    expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});
