/** Below this many non-whitespace characters we assume the PDF has no text layer. */
export const MIN_TEXT_CHARACTERS = 50;

/** One text fragment from pdf.js getTextContent(). */
export interface TextFragment {
  str: string;
  hasEOL: boolean;
}

/** Joins pdf.js text fragments into lines and normalizes whitespace. */
export function buildPageText(fragments: readonly TextFragment[]): string {
  const raw = fragments.map((fragment) => fragment.str + (fragment.hasEOL ? '\n' : '')).join('');
  return normalizeText(raw);
}

export function normalizeText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // Runs of spaces, tabs, NBSPs and other non-newline whitespace → one space.
      .replace(/[^\S\n]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      // At most one empty line between paragraphs.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Joins page texts with a page marker so page boundaries survive in the plain text. */
export function joinPages(pageTexts: readonly string[]): string {
  return pageTexts
    .map((pageText, index) => `--- Strona ${String(index + 1)} ---\n${pageText}`)
    .join('\n\n');
}

export function hasTextLayer(pageTexts: readonly string[]): boolean {
  const characters = pageTexts.reduce((sum, text) => sum + text.replace(/\s/g, '').length, 0);
  return characters >= MIN_TEXT_CHARACTERS;
}
