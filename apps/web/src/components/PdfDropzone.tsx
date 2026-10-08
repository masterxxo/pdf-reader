import { MAX_FILE_SIZE_MB } from '@pdf-insight/shared';
import { forwardRef, useId, useState, type DragEvent } from 'react';

interface PdfDropzoneProps {
  disabled: boolean;
  onActivate: () => void;
  onFileDrop: (file: File) => void;
}

export const PdfDropzone = forwardRef<HTMLButtonElement, PdfDropzoneProps>(function PdfDropzone(
  { disabled, onActivate, onFileDrop },
  ref,
) {
  const hintId = useId();
  const [isDragging, setIsDragging] = useState(false);

  // A native <button> handles Enter/Space activation and focus out of the box.
  // aria-disabled (not disabled) keeps it focusable and still receiving drag
  // events, so a drop while busy is swallowed instead of opening the PDF in the tab.
  const handleClick = () => {
    if (!disabled) {
      onActivate();
    }
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) {
      onFileDrop(file);
    }
  };

  const className = ['dropzone', isDragging && 'dropzone--active', disabled && 'dropzone--disabled']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={className}
      aria-disabled={disabled}
      aria-describedby={hintId}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <svg
        className="dropzone-icon"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M12 18v-6" />
        <path d="m9 15 3-3 3 3" />
      </svg>
      <span className="dropzone-label">Przeciągnij plik PDF tutaj lub kliknij, aby wybrać</span>
      <span id={hintId} className="dropzone-hint">
        Tylko PDF, maks. {MAX_FILE_SIZE_MB} MB
      </span>
    </button>
  );
});
