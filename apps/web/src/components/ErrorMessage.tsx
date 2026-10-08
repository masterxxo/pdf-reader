interface ErrorMessageProps {
  message: string;
  onRetry: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="error" role="alert">
      <p className="error-message">{message}</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        Spróbuj ponownie
      </button>
    </div>
  );
}
