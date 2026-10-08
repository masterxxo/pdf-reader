import { PdfExtractionError, toPdfExtractionError } from './pdfErrors';
import { buildPageText, hasTextLayer, joinPages } from './pdfText';

export interface PdfExtraction {
  /** All pages joined with page markers. */
  text: string;
  pages: number;
  pageTexts: string[];
}

// Resolved by Vite at build time, so it works under the GitHub Pages base path.
const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

async function loadPdfJs() {
  // Dynamic import keeps pdf.js out of the initial bundle.
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

export async function extractPdfText(file: File): Promise<PdfExtraction> {
  try {
    const pdfjs = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data });

    try {
      const document = await loadingTask.promise;
      const pageTexts: string[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const fragments = content.items.filter((item) => 'str' in item);
        pageTexts.push(buildPageText(fragments));
        page.cleanup();
      }

      if (!hasTextLayer(pageTexts)) {
        throw new PdfExtractionError('no-text-layer');
      }

      return { text: joinPages(pageTexts), pages: document.numPages, pageTexts };
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    throw toPdfExtractionError(error);
  }
}
