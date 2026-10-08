import { describe, expect, it } from 'vitest';
import { normalizePages, normalizeText, splitPages } from './normalizeText';

/** Joins pages like the web app does (apps/web/src/lib/pdfText.ts). */
function joinPages(pages: readonly string[]): string {
  return pages.map((page, index) => `--- Strona ${String(index + 1)} ---\n${page}`).join('\n\n');
}

const HEADER = 'ACME S.A. – Raport roczny 2025';

function reportPage(n: number, total: number, body: string): string {
  return [HEADER, body, `Strona ${String(n)} z ${String(total)}`].join('\n');
}

describe('splitPages', () => {
  it('splits on page markers and drops them', () => {
    expect(splitPages(joinPages(['Pierwsza', 'Druga']))).toEqual(['Pierwsza\n', 'Druga']);
  });

  it('treats text without markers as one page', () => {
    expect(splitPages('Bez znaczników\nstron')).toEqual(['Bez znaczników\nstron']);
  });
});

describe('normalizeText', () => {
  it('removes a running header and a numbered footer repeated on most pages', () => {
    const bodies = ['Wstęp do raportu.', 'Wyniki finansowe.', 'Ryzyka.', 'Perspektywy.'];
    const text = joinPages(bodies.map((body, i) => reportPage(i + 1, bodies.length, body)));

    expect(normalizeText(text)).toBe(bodies.join('\n\n'));
  });

  it('keeps a header that appears on too few pages', () => {
    const pages = [`${HEADER}\nA`, 'B', 'C', 'D', 'E'];
    expect(normalizeText(joinPages(pages))).toContain(HEADER);
  });

  it('keeps repeated lines in the middle of a page (content, not a header)', () => {
    const line = 'Razem do zapłaty';
    const pages = ['1', '2', '3'].map(
      (n) =>
        `Początek ${n}\nWstęp ${n}\nTekst ${n}\n${line}\nDalej ${n}\nKoniec ${n}\nStop ${n}\nOstatnia ${n}`,
    );
    expect(normalizeText(joinPages(pages)).split(line)).toHaveLength(4);
  });

  it('does not detect repeats in documents with fewer than 3 pages', () => {
    const text = joinPages([reportPage(1, 2, 'A'), reportPage(2, 2, 'B')]);
    expect(normalizeText(text).split(HEADER)).toHaveLength(3);
  });

  /** Eight pages with `line` at the end of page 7 (the only varying line). */
  function withLineOnPage7(line: string): string {
    const words = ['Wstęp', 'Cel', 'Zakres', 'Koszty', 'Ryzyka', 'Plan', 'Wnioski', 'Załączniki'];
    const pages = words.map((word) => `${word}.`);
    pages[6] = `${pages[6] ?? ''}\n${line}`;
    return joinPages(pages);
  }

  it.each(['7', '8', '- 7 -', 'Strona 7', 'str. 7 z 12', 'Page 7 of 12', '7/12', '— 7 —'])(
    'removes the page number "%s" at the edge of a page',
    (pageNumber) => {
      expect(normalizeText(withLineOnPage7(pageNumber))).not.toContain(`\n${pageNumber}`);
    },
  );

  it.each(['2025', '120', 'Art. 7', '7 dni', '12 500,00 zł', 'Strona umowy'])(
    'keeps "%s", which is not a page number',
    (line) => {
      expect(normalizeText(withLineOnPage7(line))).toContain(`Wnioski.\n${line}`);
    },
  );

  it('keeps a page number pattern in the middle of a page', () => {
    const page = ['Nagłówek', 'Wstęp', 'Opis', 'Strona 1', 'Dalej', 'Więcej', 'Koniec'].join('\n');
    expect(normalizeText(page)).toBe(page);
  });

  it('collapses whitespace and empty lines', () => {
    expect(normalizeText('  Ala \t ma  kota  \r\n\r\n\r\n\r\nKot  ma Alę ')).toBe(
      'Ala ma kota\n\nKot ma Alę',
    );
  });

  it('keeps empty pages out of the joined text', () => {
    expect(normalizeText(joinPages(['A', '', '3', 'B']))).toBe('A\n\nB');
  });

  it('keeps every other line, in order', () => {
    const pages = ['Umowa nr 1/2026', 'Strony umowy: ACME i Beta', '§ 1. Przedmiot umowy'];
    expect(normalizeText(joinPages(pages))).toBe(pages.join('\n\n'));
  });
});

describe('normalizePages', () => {
  it('returns one normalized text per page', () => {
    const text = joinPages([reportPage(1, 3, 'A'), reportPage(2, 3, 'B'), reportPage(3, 3, 'C')]);
    expect(normalizePages(text)).toEqual(['A', 'B', 'C']);
  });
});
