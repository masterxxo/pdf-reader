import { describe, expect, it } from 'vitest';
import { buildPageText, hasTextLayer, joinPages, normalizeText } from './pdfText';

describe('normalizeText', () => {
  it('collapses runs of spaces, tabs and non-breaking spaces', () => {
    expect(normalizeText('Faktura\t  nr  12')).toBe('Faktura nr 12');
  });

  it('trims lines and limits blank lines to one', () => {
    expect(normalizeText('  Akapit 1  \r\n\r\n\r\n\n  Akapit 2 ')).toBe('Akapit 1\n\nAkapit 2');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeText(' \n\t \n ')).toBe('');
  });
});

describe('buildPageText', () => {
  it('joins fragments and breaks lines at hasEOL', () => {
    const text = buildPageText([
      { str: 'Umowa', hasEOL: false },
      { str: ' najmu', hasEOL: true },
      { str: 'Strony umowy:', hasEOL: true },
    ]);
    expect(text).toBe('Umowa najmu\nStrony umowy:');
  });
});

describe('joinPages', () => {
  it('separates pages with numbered markers', () => {
    expect(joinPages(['Pierwsza', 'Druga'])).toBe(
      '--- Strona 1 ---\nPierwsza\n\n--- Strona 2 ---\nDruga',
    );
  });
});

describe('hasTextLayer', () => {
  it('is false when pages contain fewer than 50 non-whitespace characters', () => {
    expect(hasTextLayer(['', '   ', 'a b c'])).toBe(false);
    expect(hasTextLayer(['x'.repeat(25), ` ${'y'.repeat(24)} `])).toBe(false);
  });

  it('is true from 50 non-whitespace characters across pages', () => {
    expect(hasTextLayer(['x'.repeat(25), 'y'.repeat(25)])).toBe(true);
  });
});
