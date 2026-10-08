import { ACCEPTED_MIME_TYPE } from '@pdf-insight/shared';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AppFooter } from './components/AppFooter';
import { AppHeader } from './components/AppHeader';
import { ErrorMessage } from './components/ErrorMessage';
import { ExtractionResult } from './components/ExtractionResult';
import { PdfDropzone } from './components/PdfDropzone';
import { extractPdfText, type PdfExtraction } from './lib/pdf';
import { toPdfExtractionError } from './lib/pdfErrors';
import { validateFile } from './lib/validateFile';

type AppState =
  | { status: 'idle' }
  | { status: 'reading'; fileName: string }
  | { status: 'extracted'; fileName: string; extraction: PdfExtraction }
  | { status: 'error'; message: string };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLButtonElement>(null);
  // Incremented per selected file; results of a superseded file are ignored.
  const runIdRef = useRef(0);

  // Dropping a file outside the dropzone would otherwise open it in the tab.
  useEffect(() => {
    const preventFileDrop = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', preventFileDrop);
    window.addEventListener('drop', preventFileDrop);
    return () => {
      window.removeEventListener('dragover', preventFileDrop);
      window.removeEventListener('drop', preventFileDrop);
    };
  }, []);

  // Single entry point for every state transition after a file is chosen.
  const handleFile = async (file: File) => {
    const runId = ++runIdRef.current;
    const isCurrentRun = () => runId === runIdRef.current;

    const validation = await validateFile(file);
    if (!isCurrentRun()) return;
    if (!validation.ok) {
      setState({ status: 'error', message: validation.message });
      return;
    }

    setState({ status: 'reading', fileName: file.name });
    try {
      const extraction = await extractPdfText(file);
      if (!isCurrentRun()) return;
      setState({ status: 'extracted', fileName: file.name, extraction });
    } catch (error) {
      if (!isCurrentRun()) return;
      setState({ status: 'error', message: toPdfExtractionError(error).message });
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so selecting the same file again still fires a change event.
    event.target.value = '';
    if (file) {
      void handleFile(file);
    }
  };

  const handleRetry = () => {
    setState({ status: 'idle' });
    dropzoneRef.current?.focus();
  };

  const isReading = state.status === 'reading';

  return (
    <div className="app">
      <AppHeader />
      <main className="app-main">
        <section className="card" aria-labelledby="upload-heading">
          <h2 id="upload-heading" className="card-title">
            Przeanalizuj dokument PDF
          </h2>

          {state.status === 'error' && (
            <ErrorMessage message={state.message} onRetry={handleRetry} />
          )}

          {state.status === 'extracted' ? (
            <ExtractionResult
              fileName={state.fileName}
              extraction={state.extraction}
              onChooseAnother={openFilePicker}
            />
          ) : (
            <PdfDropzone
              ref={dropzoneRef}
              disabled={isReading}
              onActivate={openFilePicker}
              onFileDrop={(file) => void handleFile(file)}
            />
          )}

          {/* Always mounted so screen readers announce status changes. */}
          <div className="status" role="status" aria-live="polite">
            {isReading && (
              <>
                <span className="spinner" aria-hidden="true" />
                <span>
                  Odczytywanie dokumentu…
                  <span className="status-file-name">{state.fileName}</span>
                </span>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME_TYPE}
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleInputChange}
          />
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
