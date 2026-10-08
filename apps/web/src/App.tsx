import { ACCEPTED_MIME_TYPE, type AnalysisResult, type AnalyzeRequest } from '@pdf-insight/shared';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { analyzeDocument } from './api/client';
import { AnalysisError, isRetryableError } from './api/errors';
import { AnalysisResultView } from './components/AnalysisResultView';
import { AppHeader } from './components/AppHeader';
import { ErrorMessage } from './components/ErrorMessage';
import { PdfDropzone } from './components/PdfDropzone';
import { extractPdfText } from './lib/pdf';
import { toPdfExtractionError } from './lib/pdfErrors';
import { validateFile } from './lib/validateFile';

type AppState =
  | { status: 'idle' }
  | { status: 'reading'; fileName: string }
  | { status: 'analyzing'; input: AnalyzeRequest }
  | { status: 'done'; result: AnalysisResult }
  // retryInput is set when the analysis can be retried with the already extracted text.
  | { status: 'error'; message: string; retryInput?: AnalyzeRequest };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLButtonElement>(null);
  // Incremented per run (file or retry); results of a superseded run are ignored.
  const runIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  /** Supersedes any run in progress and returns a checker for the new one. */
  const startRun = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const runId = ++runIdRef.current;
    return () => runId === runIdRef.current;
  };

  const analyze = async (input: AnalyzeRequest, isCurrentRun: () => boolean) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setState({ status: 'analyzing', input });
    try {
      const result = await analyzeDocument(input, { signal: controller.signal });
      if (!isCurrentRun()) return;
      setState({ status: 'done', result });
    } catch (error) {
      if (!isCurrentRun() || controller.signal.aborted) return;
      const analysisError =
        error instanceof AnalysisError ? error : new AnalysisError('UNKNOWN', { cause: error });
      setState({
        status: 'error',
        message: analysisError.message,
        retryInput: isRetryableError(analysisError.code) ? input : undefined,
      });
    }
  };

  // Single entry point for every state transition after a file is chosen.
  const handleFile = async (file: File) => {
    const isCurrentRun = startRun();

    const validation = await validateFile(file);
    if (!isCurrentRun()) return;
    if (!validation.ok) {
      setState({ status: 'error', message: validation.message });
      return;
    }

    setState({ status: 'reading', fileName: file.name });
    let extraction;
    try {
      extraction = await extractPdfText(file);
    } catch (error) {
      if (!isCurrentRun()) return;
      setState({ status: 'error', message: toPdfExtractionError(error).message });
      return;
    }
    if (!isCurrentRun()) return;

    // Analysis starts automatically; only text and metadata leave the browser.
    await analyze(
      { fileName: file.name, pages: extraction.pages, text: extraction.text },
      isCurrentRun,
    );
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
    if (state.status === 'error' && state.retryInput) {
      // Re-send the already extracted text; the PDF is not read again.
      void analyze(state.retryInput, startRun());
      return;
    }
    setState({ status: 'idle' });
    dropzoneRef.current?.focus();
  };

  const isReading = state.status === 'reading';
  const busyFileName =
    state.status === 'reading'
      ? state.fileName
      : state.status === 'analyzing'
        ? state.input.fileName
        : null;

  return (
    <div className="app">
      <AppHeader />
      <main className="app-main">
        {state.status === 'done' ? (
          <AnalysisResultView result={state.result} onAnalyzeAnother={openFilePicker} />
        ) : (
          <section className="card" aria-labelledby="upload-heading">
            <h2 id="upload-heading" className="card-title">
              Przeanalizuj dokument PDF
            </h2>

            {state.status === 'error' && (
              <ErrorMessage message={state.message} onRetry={handleRetry} />
            )}

            {/* Stays usable while analyzing: a new file aborts the request in flight. */}
            <PdfDropzone
              ref={dropzoneRef}
              disabled={isReading}
              onActivate={openFilePicker}
              onFileDrop={(file) => void handleFile(file)}
            />

            <p className="privacy-notice">
              Treść dokumentu zostanie wysłana do zewnętrznego API sztucznej inteligencji (Google
              Gemini) w celu analizy. Nie przesyłaj dokumentów zawierających poufne dane.
            </p>

            {/* Always mounted so screen readers announce status changes. */}
            <div className="status" role="status" aria-live="polite">
              {busyFileName !== null && (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span>
                    {isReading ? 'Odczytywanie dokumentu…' : 'Analizowanie treści…'}
                    <span className="status-file-name">{busyFileName}</span>
                  </span>
                </>
              )}
            </div>
          </section>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MIME_TYPE}
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleInputChange}
        />
      </main>
    </div>
  );
}
