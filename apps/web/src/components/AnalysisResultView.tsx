import type { AnalysisResult } from '@pdf-insight/shared';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  DOCUMENT_TYPE_LABELS,
  formatAmount,
  formatDate,
  formatLanguage,
  formatNumber,
} from '../lib/format';
import { ResultSection } from './ResultSection';

interface AnalysisResultViewProps {
  result: AnalysisResult;
  onAnalyzeAnother: () => void;
  /** Extra content rendered after the result sections (e.g. the JSON preview). */
  children?: ReactNode;
}

function TextList({ items }: { items: readonly string[] }) {
  return (
    <ul className="analysis-list">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

// All model output is rendered as React text nodes, so it can never become HTML.
export function AnalysisResultView({
  result,
  onAnalyzeAnother,
  children,
}: AnalysisResultViewProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { document, summary, keyPoints, entities, amounts, dates, keywords } = result;

  // Move focus to the results so keyboard and screen reader users land on them.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <article className="card card--wide analysis" aria-labelledby={headingId}>
      <header className="analysis-header">
        <p className="analysis-eyebrow">Wynik analizy</p>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="analysis-title">
          {document.title ?? document.fileName}
        </h2>
        <dl className="analysis-meta">
          <div>
            <dt>Typ dokumentu</dt>
            <dd>{DOCUMENT_TYPE_LABELS[document.type]}</dd>
          </div>
          <div>
            <dt>Język</dt>
            <dd>{formatLanguage(document.language)}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{document.date ? formatDate(document.date) : 'Brak danych'}</dd>
          </div>
          <div>
            <dt>Liczba stron</dt>
            <dd>{formatNumber(document.pages)}</dd>
          </div>
          <div>
            <dt>Plik</dt>
            <dd className="analysis-file-name">{document.fileName}</dd>
          </div>
        </dl>
      </header>

      <ResultSection title="Podsumowanie">
        <p className="analysis-summary">{summary}</p>
      </ResultSection>

      <ResultSection title="Najważniejsze punkty" isEmpty={keyPoints.length === 0}>
        <TextList items={keyPoints} />
      </ResultSection>

      <div className="analysis-columns">
        <ResultSection title="Organizacje" isEmpty={entities.organizations.length === 0}>
          <TextList items={entities.organizations} />
        </ResultSection>
        <ResultSection title="Osoby" isEmpty={entities.people.length === 0}>
          <TextList items={entities.people} />
        </ResultSection>
      </div>

      <ResultSection title="Kwoty" isEmpty={amounts.length === 0}>
        <ul className="analysis-entries">
          {amounts.map((amount, index) => (
            <li key={index}>
              <span className="analysis-entry-value">
                {formatAmount(amount.value, amount.currency)}
              </span>
              {amount.context && <span className="analysis-entry-context">{amount.context}</span>}
            </li>
          ))}
        </ul>
      </ResultSection>

      <ResultSection title="Daty" isEmpty={dates.length === 0}>
        <ul className="analysis-entries">
          {dates.map((entry, index) => (
            <li key={index}>
              <time className="analysis-entry-value" dateTime={entry.date}>
                {formatDate(entry.date)}
              </time>
              {entry.context && <span className="analysis-entry-context">{entry.context}</span>}
            </li>
          ))}
        </ul>
      </ResultSection>

      <ResultSection title="Słowa kluczowe" isEmpty={keywords.length === 0}>
        <ul className="tags">
          {keywords.map((keyword, index) => (
            <li key={index} className="tag">
              {keyword}
            </li>
          ))}
        </ul>
      </ResultSection>

      {children}

      <div className="analysis-actions">
        <button type="button" className="button button--primary" onClick={onAnalyzeAnother}>
          Analizuj inny plik
        </button>
      </div>
    </article>
  );
}
