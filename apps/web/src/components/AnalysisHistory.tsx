import { useEffect, useRef, useState } from 'react';
import { DOCUMENT_TYPE_LABELS, formatDateTime } from '../lib/format';
import type { HistoryEntry } from '../lib/history';

interface AnalysisHistoryProps {
  entries: readonly HistoryEntry[];
  onOpen: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function AnalysisHistory({ entries, onOpen, onRemove, onClear }: AnalysisHistoryProps) {
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const wasConfirmingRef = useRef(false);

  // Focus follows the confirmation step: into it when it opens, back to
  // "Wyczyść historię" when it is cancelled (after confirming, that button is gone).
  useEffect(() => {
    if (isConfirmingClear) {
      confirmButtonRef.current?.focus();
    } else if (wasConfirmingRef.current) {
      clearButtonRef.current?.focus();
    }
    wasConfirmingRef.current = isConfirmingClear;
  }, [isConfirmingClear]);

  // The focused delete button disappears with its entry, so keep focus in the section.
  const handleRemove = (id: string) => {
    onRemove(id);
    headingRef.current?.focus();
  };

  const handleCancelClear = () => {
    setIsConfirmingClear(false);
  };

  const handleConfirmClear = () => {
    setIsConfirmingClear(false);
    onClear();
    headingRef.current?.focus();
  };

  return (
    <section className="history" aria-labelledby="history-heading">
      <h3 id="history-heading" ref={headingRef} tabIndex={-1} className="history-title">
        Ostatnie analizy
      </h3>
      <p className="history-notice">
        Historia jest zapisywana tylko w tej przeglądarce, na tym urządzeniu.
      </p>

      {entries.length === 0 ? (
        <p className="history-empty">
          Brak zapisanych analiz. Wyniki pojawią się tutaj po pierwszej analizie.
        </p>
      ) : (
        <>
          <ul className="history-list">
            {entries.map((entry) => (
              <li key={entry.id} className="history-item">
                <button
                  type="button"
                  className="history-open"
                  onClick={() => {
                    onOpen(entry);
                  }}
                >
                  <span className="history-file-name">{entry.fileName}</span>
                  <span className="history-meta">
                    {DOCUMENT_TYPE_LABELS[entry.result.document.type]} ·{' '}
                    <time dateTime={entry.analyzedAt}>{formatDateTime(entry.analyzedAt)}</time>
                  </span>
                </button>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  aria-label={`Usuń z historii: ${entry.fileName}`}
                  onClick={() => {
                    handleRemove(entry.id);
                  }}
                >
                  Usuń
                </button>
              </li>
            ))}
          </ul>

          {isConfirmingClear ? (
            <div
              className="history-confirm"
              role="group"
              aria-labelledby="history-confirm-text"
              onKeyDown={(event) => {
                if (event.key === 'Escape') handleCancelClear();
              }}
            >
              <p id="history-confirm-text">Usunąć wszystkie zapisane analizy?</p>
              <div className="analysis-actions">
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className="button button--danger"
                  onClick={handleConfirmClear}
                >
                  Tak, wyczyść
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleCancelClear}
                >
                  Anuluj
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={clearButtonRef}
              type="button"
              className="button button--secondary"
              onClick={() => {
                setIsConfirmingClear(true);
              }}
            >
              Wyczyść historię
            </button>
          )}
        </>
      )}
    </section>
  );
}
