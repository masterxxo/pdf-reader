import { useId, type ReactNode } from 'react';

interface ResultSectionProps {
  title: string;
  isEmpty?: boolean;
  children: ReactNode;
}

/** A titled part of the results; shows "Brak danych" instead of disappearing when empty. */
export function ResultSection({ title, isEmpty = false, children }: ResultSectionProps) {
  const headingId = useId();
  return (
    <section className="analysis-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="analysis-section-title">
        {title}
      </h3>
      {isEmpty ? <p className="analysis-empty">Brak danych</p> : children}
    </section>
  );
}
