import { useEffect, useRef } from 'react';

interface ErrorMessageProps {
  message: string;
  onRetry: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Move focus to the error so keyboard users land next to "Spróbuj ponownie".
  useEffect(() => {
    containerRef.current?.focus();
  }, [message]);

  return (
    <div ref={containerRef} className="error" role="alert" tabIndex={-1}>
      <p className="error-message">{message}</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        Spróbuj ponownie
      </button>
    </div>
  );
}
