/**
 * Shrinks extracted PDF text before analysis without losing content: removes
 * running headers and footers, standalone page numbers and the page markers
 * added by the web app, and collapses whitespace. Pure.
 */

/** Page marker added by the web app between pages (apps/web/src/lib/pdfText.ts). */
const PAGE_MARKER_LINE = /^--- Strona \d+ ---$/;

/** "Strona 7", "str. 7 z 12", "Page 7 of 12", "7/12", "- 7 -"; group 1 is the number. */
const PAGE_LABEL_LINE =
  /^[-–—]?\s*(?:(?:strona|str\.|s\.|page|p\.)\s*)?(\d{1,4})(?:\s*(?:z|ze|\/|of)\s*\d{1,4})?\s*[-–—]?$/i;
/** A bare number such as "7"; only a page number if close to the page's position. */
const BARE_NUMBER_LINE = /^\d+$/;
/** Allowed difference between a bare page number and the page's index (e.g. unnumbered cover pages). */
const PAGE_NUMBER_OFFSET = 3;

/** Headers and footers are looked for only this many lines from either end of a page. */
const EDGE_LINES = 3;
/** A line repeated on at least this share of pages is a running header or footer. */
const REPEATED_SHARE = 0.6;
/** Fewer pages give too little evidence that a line repeats. */
const MIN_PAGES_FOR_REPEATS = 3;

/** Splits text on the web app's page markers; text without markers is one page. */
export function splitPages(text: string): string[] {
  const pages: string[][] = [[]];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (PAGE_MARKER_LINE.test(line.trim())) {
      pages.push([]);
    } else {
      pages[pages.length - 1]?.push(line);
    }
  }
  // Drops the empty "page" before the first marker.
  const texts = pages.map((lines) => lines.join('\n'));
  return texts[0]?.trim() === '' && texts.length > 1 ? texts.slice(1) : texts;
}

function collapseWhitespace(line: string): string {
  return line.replace(/[^\S\n]+/g, ' ').trim();
}

/** Same for a header on page 3 ("Strona 3 z 12") and page 4 ("Strona 4 z 12"). */
function repeatKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, '#');
}

function edgeLines(lines: readonly string[]): string[] {
  const nonEmpty = lines.filter((line) => line !== '');
  return [...nonEmpty.slice(0, EDGE_LINES), ...nonEmpty.slice(-EDGE_LINES)];
}

/**
 * Whether a line at the edge of page `index` (0-based) is its page number. A
 * bare number must be close to the page's position, so a year or an amount
 * at the end of a page is kept.
 */
function isPageNumber(line: string, index: number): boolean {
  const match = PAGE_LABEL_LINE.exec(line);
  if (!match) {
    return false;
  }
  if (!BARE_NUMBER_LINE.test(line)) {
    return true;
  }
  return Math.abs(Number(match[1]) - (index + 1)) <= PAGE_NUMBER_OFFSET;
}

/** Keys of edge lines that repeat on most pages. */
function findRepeatedLines(pages: readonly (readonly string[])[]): Set<string> {
  const repeated = new Set<string>();
  if (pages.length < MIN_PAGES_FOR_REPEATS) {
    return repeated;
  }
  const pageCounts = new Map<string, number>();
  for (const lines of pages) {
    for (const key of new Set(edgeLines(lines).map(repeatKey))) {
      pageCounts.set(key, (pageCounts.get(key) ?? 0) + 1);
    }
  }
  const minPages = Math.max(MIN_PAGES_FOR_REPEATS, Math.ceil(pages.length * REPEATED_SHARE));
  for (const [key, count] of pageCounts) {
    if (count >= minPages) {
      repeated.add(key);
    }
  }
  return repeated;
}

/**
 * Returns the normalized text of each page (page markers removed). Pages stay
 * separate so the caller can split long documents on page boundaries.
 */
export function normalizePages(text: string): string[] {
  const pages = splitPages(text).map((page) => page.split('\n').map(collapseWhitespace));
  const repeated = findRepeatedLines(pages);

  return pages.map((lines, index) => {
    // Headers, footers and page numbers are only removed at the edges of a page.
    const edges = new Set(edgeLines(lines));
    return lines
      .filter(
        (line) => !edges.has(line) || !(isPageNumber(line, index) || repeated.has(repeatKey(line))),
      )
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
}

/** The whole document, normalized, with pages separated by an empty line. */
export function normalizeText(text: string): string {
  return normalizePages(text)
    .filter((page) => page !== '')
    .join('\n\n');
}
