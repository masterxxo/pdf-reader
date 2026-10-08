import { describe, expect, it } from 'vitest';
import { analysisCacheKey } from './cache';

describe('analysisCacheKey', () => {
  it('is a stable SHA-256 hex digest of the text', async () => {
    const key = await analysisCacheKey('Faktura nr 1');
    expect(key).toMatch(/^analysis:v1:[0-9a-f]{64}$/);
    expect(await analysisCacheKey('Faktura nr 1')).toBe(key);
  });

  it('differs for different texts', async () => {
    expect(await analysisCacheKey('Faktura nr 1')).not.toBe(await analysisCacheKey('Faktura nr 2'));
  });
});
