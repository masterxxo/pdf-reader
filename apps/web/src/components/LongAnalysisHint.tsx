import { useEffect, useState } from 'react';

/** After this long without a result, the user is told that the analysis may take a while. */
export const LONG_ANALYSIS_HINT_DELAY_MS = 10_000;

/** Mount when the analysis starts; shows the hint once the delay has passed. */
export function LongAnalysisHint() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, LONG_ANALYSIS_HINT_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return isVisible ? (
    <span className="status-hint">Długi dokument — analiza może potrwać dłużej…</span>
  ) : null;
}
