import { describe, expect, it } from 'vitest';
import { DEFAULT_LONG_DOCUMENT_CONFIG, parseLongDocumentConfig } from './config';

describe('parseLongDocumentConfig', () => {
  it('reads positive integers from wrangler vars', () => {
    expect(
      parseLongDocumentConfig({
        SINGLE_CALL_MAX_TOKENS: '30000',
        MAX_CHUNKS: '3',
        CHUNK_CONCURRENCY: '1',
      }),
    ).toEqual({ singleCallMaxTokens: 30_000, maxChunks: 3, concurrency: 1 });
  });

  it.each([undefined, '', '0', '-5', '1.5', 'abc'])('falls back to defaults for %j', (value) => {
    expect(
      parseLongDocumentConfig({
        SINGLE_CALL_MAX_TOKENS: value,
        MAX_CHUNKS: value,
        CHUNK_CONCURRENCY: value,
      }),
    ).toEqual(DEFAULT_LONG_DOCUMENT_CONFIG);
  });
});
