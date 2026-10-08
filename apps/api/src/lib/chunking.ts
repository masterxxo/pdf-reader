import { CHARS_PER_TOKEN, estimateTokens } from './metrics';

/** A piece of text that is never split, and the separator that follows it. */
interface Unit {
  text: string;
  separator: string;
}

/** Splits `text` on `separator` into units, keeping the separator for rejoining. */
function splitOn(text: string, separator: string): Unit[] {
  return text.split(separator).map((part) => ({ text: part, separator }));
}

/** Last resort for a single line longer than a chunk: split at spaces. */
function splitLongLine(line: string, maxChars: number): Unit[] {
  const units: Unit[] = [];
  let rest = line;
  while (rest.length > maxChars) {
    const space = rest.lastIndexOf(' ', maxChars);
    const end = space > 0 ? space : maxChars;
    units.push({ text: rest.slice(0, end), separator: ' ' });
    rest = rest.slice(end).trimStart();
  }
  units.push({ text: rest, separator: ' ' });
  return units;
}

/**
 * Paragraphs (pages are separated by empty lines too), then lines of
 * paragraphs that are too long on their own, then words of such lines.
 */
function toUnits(text: string, maxChars: number): Unit[] {
  return splitOn(text, '\n\n').flatMap((paragraph) => {
    if (paragraph.text.length <= maxChars) {
      return [paragraph];
    }
    const lines = splitOn(paragraph.text, '\n').flatMap((line) =>
      line.text.length <= maxChars ? [line] : splitLongLine(line.text, maxChars),
    );
    // The last piece of a paragraph is followed by the paragraph separator.
    const last = lines.at(-1);
    if (last) {
      last.separator = paragraph.separator;
    }
    return lines;
  });
}

function join(units: readonly Unit[]): string {
  return units
    .map((unit, index) => unit.text + (index < units.length - 1 ? unit.separator : ''))
    .join('')
    .trim();
}

/**
 * Splits text into as few chunks as fit `maxChunkTokens` each (estimated),
 * of similar size, cutting only between paragraphs or pages when possible.
 * Text that fits is returned as a single chunk. Pure.
 */
export function splitIntoChunks(text: string, maxChunkTokens: number): string[] {
  if (estimateTokens(text) <= maxChunkTokens) {
    return [text];
  }
  const maxChars = Math.floor(maxChunkTokens * CHARS_PER_TOKEN);
  const count = Math.ceil(text.length / maxChars);
  // Aim for equal chunks; a chunk is closed early only to stay under maxChars.
  const targetChars = Math.ceil(text.length / count);

  const chunks: string[] = [];
  let current: Unit[] = [];
  let currentChars = 0;
  for (const unit of toUnits(text, maxChars)) {
    const size = unit.text.length + unit.separator.length;
    if (current.length > 0 && currentChars + size > maxChars) {
      chunks.push(join(current));
      current = [];
      currentChars = 0;
    }
    current.push(unit);
    currentChars += size;
    if (currentChars >= targetChars) {
      chunks.push(join(current));
      current = [];
      currentChars = 0;
    }
  }
  if (current.length > 0) {
    chunks.push(join(current));
  }
  return chunks.filter((chunk) => chunk !== '');
}
