import { describe, expect, it } from 'vitest';
import { splitIntoChunks } from './chunking';
import { CHARS_PER_TOKEN, estimateTokens } from './metrics';

/** `count` paragraphs of about `chars` characters each, numbered for order checks. */
function paragraphs(count: number, chars: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const label = `Akapit ${String(i + 1)}.`;
    return `${label} ${'x'.repeat(Math.max(0, chars - label.length - 1))}`;
  });
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe('splitIntoChunks', () => {
  it('returns text that fits as a single chunk', () => {
    const text = paragraphs(3, 100).join('\n\n');
    expect(splitIntoChunks(text, 1_000)).toEqual([text]);
  });

  it('splits into as few chunks as fit, of similar size', () => {
    const text = paragraphs(40, 270).join('\n\n'); // ~4,000 tokens
    const chunks = splitIntoChunks(text, 1_500);

    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(1_500);
    }
    const sizes = chunks.map((chunk) => chunk.length);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.5);
  });

  it('cuts only between paragraphs and loses or reorders nothing', () => {
    const parts = paragraphs(25, 300);
    const chunks = splitIntoChunks(parts.join('\n\n'), 1_000);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('Akapit ')).toBe(true);
    }
    expect(chunks.join('\n\n')).toBe(parts.join('\n\n'));
  });

  it('splits a paragraph that is too long on its own at line breaks', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Linia ${String(i + 1)} ${'y'.repeat(80)}`);
    const text = lines.join('\n');
    const maxTokens = 600;
    const chunks = splitIntoChunks(text, maxTokens);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxTokens * CHARS_PER_TOKEN);
      expect(chunk.startsWith('Linia ')).toBe(true);
    }
    expect(words(chunks.join('\n'))).toEqual(words(text));
  });

  it('splits a single overlong line at spaces as a last resort', () => {
    const text = Array.from({ length: 3_000 }, (_, i) => `słowo${String(i)}`).join(' ');
    const chunks = splitIntoChunks(text, 2_000);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2_000 * CHARS_PER_TOKEN);
    }
    expect(words(chunks.join(' '))).toEqual(words(text));
  });
});
