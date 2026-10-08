import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ACCEPTED_MIME_TYPE, MAX_FILE_SIZE_MB } from '@pdf-insight/shared';

export function PdfDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  // A native <button> handles Enter/Space activation and focus out of the box.
  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
    }
    // Reset so selecting the same file again still fires a change event.
    event.target.value = '';
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      setFileName(file.name);
    }
  };

  return (
    <div className="dropzone-wrapper">
      <button
        type="button"
        className={isDragging ? 'dropzone dropzone--active' : 'dropzone'}
        onClick={openFilePicker}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-describedby={hintId}
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
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MIME_TYPE}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleInputChange}
      />
      <p className="dropzone-status" aria-live="polite">
        {fileName && (
          <>
            Wybrany plik: <strong className="dropzone-file-name">{fileName}</strong>
          </>
        )}
      </p>
    </div>
  );
}
