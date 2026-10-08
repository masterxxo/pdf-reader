import AxeBuilder from '@axe-core/playwright';
import type { AnalysisResult } from '@pdf-insight/shared';
import { expect, type Browser, type Page } from '@playwright/test';

/** A fictional invoice: generated content only, no real people or companies. */
const SAMPLE_INVOICE_HTML = `<!doctype html>
<html lang="pl">
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; font-size: 12pt; margin: 2cm; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  td, th { border: 1px solid #999; padding: 6px; text-align: left; }
</style></head>
<body>
  <h1>Faktura VAT nr FV/2026/10/042</h1>
  <p>Data wystawienia: 1 października 2026 r. Termin płatności: 15 października 2026 r.</p>
  <p><strong>Sprzedawca:</strong> Przykładowe Studio Sp. z o.o., ul. Testowa 1, 00-001 Warszawa, NIP 000-000-00-00</p>
  <p><strong>Nabywca:</strong> Demo Logistyka S.A., ul. Fikcyjna 5, 30-001 Kraków</p>
  <table>
    <tr><th>Usługa</th><th>Netto</th><th>VAT</th><th>Brutto</th></tr>
    <tr><td>Projekt i wdrożenie aplikacji webowej (wrzesień 2026)</td><td>10 000,00 PLN</td><td>2 300,00 PLN</td><td>12 300,00 PLN</td></tr>
    <tr><td>Utrzymanie i hosting (październik 2026)</td><td>1 500,00 PLN</td><td>345,00 PLN</td><td>1 845,00 PLN</td></tr>
  </table>
  <p><strong>Razem do zapłaty: 14 145,00 PLN</strong></p>
  <p>Płatność przelewem na rachunek sprzedawcy. Osoba kontaktowa: Anna Przykładowa.</p>
  <p>Faktura dotyczy umowy ramowej z dnia 3 marca 2026 r.</p>
</body>
</html>`;

/** No text at all, like a scanned page: pdf.js finds no text layer. */
const NO_TEXT_HTML = `<!doctype html><html><body>
  <svg width="400" height="300"><rect width="400" height="300" fill="#ccc"/></svg>
</body></html>`;

async function renderPdf(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return await page.pdf({ format: 'A4' });
  } finally {
    await page.close();
  }
}

export const createSampleInvoicePdf = (browser: Browser) => renderPdf(browser, SAMPLE_INVOICE_HTML);
export const createNoTextPdf = (browser: Browser) => renderPdf(browser, NO_TEXT_HTML);

export const LONG_FILE_NAME = `${'bardzo-dluga-nazwa-pliku-bez-spacji-'.repeat(6)}faktura.pdf`;

export function makeResult(fileName: string): AnalysisResult {
  return {
    document: {
      fileName,
      pages: 1,
      language: 'pl',
      type: 'invoice',
      title: 'Faktura VAT nr FV/2026/10/042',
      date: '2026-10-01',
    },
    summary:
      'Faktura wystawiona przez Przykładowe Studio Sp. z o.o. dla Demo Logistyka S.A. za projekt aplikacji webowej oraz utrzymanie. Łączna kwota do zapłaty wynosi 14 145,00 PLN. Termin płatności upływa 15 października 2026 r.',
    keyPoints: [
      'Projekt i wdrożenie aplikacji webowej za wrzesień 2026',
      'Utrzymanie i hosting za październik 2026',
      'Płatność przelewem do 15 października 2026',
    ],
    entities: {
      organizations: ['Przykładowe Studio Sp. z o.o.', 'Demo Logistyka S.A.'],
      people: ['Anna Przykładowa'],
    },
    amounts: [
      { value: 14145, currency: 'PLN', context: 'Razem do zapłaty' },
      // A long unbroken value, to check that long JSON lines stay inside their container.
      { value: 12300, currency: 'PLN', context: 'x'.repeat(200) },
    ],
    dates: [
      { date: '2026-10-01', context: 'Data wystawienia' },
      { date: '2026-10-15', context: 'Termin płatności' },
    ],
    keywords: ['faktura', 'aplikacja webowa', 'hosting'],
  };
}

export const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

/** Runs axe (WCAG 2.x A/AA rules) on the current page and fails on any violation. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const summary = violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
