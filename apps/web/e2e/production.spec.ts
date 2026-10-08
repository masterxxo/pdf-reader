import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AnalysisResultSchema } from '@pdf-insight/shared';
import { expect, test } from '@playwright/test';
import { createSampleInvoicePdf } from './fixtures';

const SCREENSHOT_PATH = fileURLToPath(new URL('../../../docs/screenshot.png', import.meta.url));

// Real end-to-end check (Definition of Done) against a deployed app with the real API.
// Uses one LLM call, so it only runs when E2E_BASE_URL is set.
test.skip(!process.env.E2E_BASE_URL, 'Set E2E_BASE_URL to run against a deployed app');

test('analyzes a PDF in under 30 s and downloads schema-valid JSON', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  const pdf = await createSampleInvoicePdf(browser);
  await page.goto('./');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Przeciągnij plik PDF/ }).click();
  const startedAt = Date.now();
  await (
    await fileChooserPromise
  ).setFiles({ name: 'faktura-przyklad.pdf', mimeType: 'application/pdf', buffer: pdf });

  const heading = page.getByRole('heading', { level: 2 }).first();
  await expect(page.getByText('Wynik analizy', { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(Date.now() - startedAt).toBeLessThan(30_000);
  await expect(heading).toBeFocused();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Pobierz JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('faktura-przyklad.analysis.json');
  const json: unknown = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(AnalysisResultSchema.safeParse(json).success).toBe(true);

  if (process.env.SCREENSHOT) {
    // No focus ring in the README screenshot.
    await heading.blur();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: SCREENSHOT_PATH });
  }
});
