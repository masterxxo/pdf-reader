import type { AnalysisResult } from '@pdf-insight/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadJson, getAnalysisFileName, toPrettyJson } from '../lib/download';

const FEEDBACK_DURATION_MS = 3000;

type CopyFeedback = 'idle' | 'copied' | 'failed';

const COPY_FEEDBACK_TEXT: Record<CopyFeedback, string> = {
  idle: '',
  copied: 'Skopiowano JSON do schowka.',
  failed: 'Nie udało się skopiować. Zaznacz tekst w podglądzie i skopiuj go ręcznie.',
};

interface JsonPreviewProps {
  result: AnalysisResult;
}

export function JsonPreview({ result }: JsonPreviewProps) {
  const json = useMemo(() => toPrettyJson(result), [result]);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>('idle');
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(feedbackTimeoutRef.current), []);

  const showFeedback = (feedback: CopyFeedback) => {
    setCopyFeedback(feedback);
    clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => {
      setCopyFeedback('idle');
    }, FEEDBACK_DURATION_MS);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      showFeedback('copied');
    } catch {
      showFeedback('failed');
    }
  };

  const handleDownload = () => {
    downloadJson(json, getAnalysisFileName(result.document.fileName));
  };

  return (
    <section className="analysis-section" aria-labelledby="json-heading">
      <h3 id="json-heading" className="analysis-section-title">
        Dane JSON
      </h3>
      <details className="json-preview">
        <summary>Pokaż podgląd JSON</summary>
        {/* Plain text node: React escapes it, nothing is interpreted as HTML. */}
        {/* A focusable, labelled region, so the scrollable preview works with the keyboard. */}
        <pre
          className="json-preview-text"
          tabIndex={0}
          role="region"
          aria-label="Wynik analizy w formacie JSON"
        >
          {json}
        </pre>
      </details>
      <div className="analysis-actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void handleCopy()}
        >
          Kopiuj JSON
        </button>
        <button type="button" className="button button--secondary" onClick={handleDownload}>
          Pobierz JSON
        </button>
      </div>
      <p
        className={
          copyFeedback === 'failed' ? 'copy-feedback copy-feedback--error' : 'copy-feedback'
        }
        role="status"
        aria-live="polite"
      >
        {COPY_FEEDBACK_TEXT[copyFeedback]}
      </p>
    </section>
  );
}
