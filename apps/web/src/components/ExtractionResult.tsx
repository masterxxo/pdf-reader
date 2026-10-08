import { useId } from 'react';
import type { PdfExtraction } from '../lib/pdf';

const PREVIEW_LENGTH = 1000;

const numberFormat = new Intl.NumberFormat('pl-PL');

interface ExtractionResultProps {
  fileName: string;
  extraction: PdfExtraction;
  onChooseAnother: () => void;
}

export function ExtractionResult({ fileName, extraction, onChooseAnother }: ExtractionResultProps) {
  const headingId = useId();
  const characterCount = extraction.pageTexts.reduce((sum, text) => sum + text.length, 0);
  const isTruncated = extraction.text.length > PREVIEW_LENGTH;
  const preview = isTruncated ? `${extraction.text.slice(0, PREVIEW_LENGTH)}…` : extraction.text;

  return (
    <section className="result" aria-labelledby={headingId}>
      <h3 id={headingId} className="result-title">
        Dokument odczytany
      </h3>
      <dl className="result-meta">
        <div>
          <dt>Plik</dt>
          <dd className="result-file-name">{fileName}</dd>
        </div>
        <div>
          <dt>Liczba stron</dt>
          <dd>{numberFormat.format(extraction.pages)}</dd>
        </div>
        <div>
          <dt>Liczba znaków</dt>
          <dd>{numberFormat.format(characterCount)}</dd>
        </div>
      </dl>
      <details className="result-preview">
        <summary>
          {isTruncated
            ? `Podgląd tekstu (pierwsze ${numberFormat.format(PREVIEW_LENGTH)} znaków)`
            : 'Podgląd tekstu'}
        </summary>
        {/* Rendered as a text node: React escapes it, so PDF content is never HTML. */}
        <pre className="result-preview-text">{preview}</pre>
      </details>
      <button type="button" className="button button--secondary" onClick={onChooseAnother}>
        Wybierz inny plik
      </button>
    </section>
  );
}
