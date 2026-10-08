import type { AnalysisResult } from '@pdf-insight/shared';

// Characters that are invalid in file names on common operating systems.
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]+/g;

/** "Faktura 10.PDF" → "Faktura 10.analysis.json" */
export function getAnalysisFileName(pdfFileName: string): string {
  const base = pdfFileName
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(UNSAFE_FILE_NAME_CHARS, '_')
    .trim();
  return `${base || 'dokument'}.analysis.json`;
}

export function toPrettyJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

/** Triggers a browser download of `content` as a JSON file. */
export function downloadJson(content: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke after the click has been handled, so the download can start.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
