import { expect, test, type Page, type Route } from '@playwright/test';
import { MOCK_API_URL } from '../playwright.config';
import {
  LONG_FILE_NAME,
  VIEWPORTS,
  createNoTextPdf,
  createSampleInvoicePdf,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  makeResult,
} from './fixtures';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type AnalyzeHandler = (route: Route) => Promise<void>;

async function mockAnalyze(page: Page, handler: AnalyzeHandler): Promise<void> {
  await page.route(`${MOCK_API_URL}/analyze`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    await handler(route);
  });
}

const respondWithResult = (fileName: string): AnalyzeHandler => {
  return (route) =>
    route.fulfill({ status: 200, headers: CORS_HEADERS, json: makeResult(fileName) });
};

/** Returns a function that releases the held request. */
async function holdRequests(page: Page, url: string): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

async function choosePdf(page: Page, name: string, buffer: Buffer): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Przeciągnij plik PDF/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({ name, mimeType: 'application/pdf', buffer });
}

async function seedHistory(page: Page, fileNames: readonly string[]): Promise<void> {
  const entries = fileNames.map((fileName, index) => ({
    id: `seed-${index}`,
    fileName,
    analyzedAt: new Date(Date.UTC(2026, 9, 8, 10, index)).toISOString(),
    result: makeResult(fileName),
  }));
  await page.addInitScript((value) => {
    window.localStorage.setItem('pdf-insight:history:v1', value);
  }, JSON.stringify(entries));
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('idle with empty history', async ({ page }) => {
      await page.goto('./');
      await expect(page.getByText('Brak zapisanych analiz.')).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page);
    });

    test('idle with history and clear confirmation', async ({ page }) => {
      await seedHistory(page, [LONG_FILE_NAME, 'umowa.pdf']);
      await page.goto('./');
      await expect(page.getByRole('button', { name: /^umowa\.pdf/ })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page);

      await page.getByRole('button', { name: 'Wyczyść historię' }).click();
      await expect(page.getByRole('button', { name: 'Tak, wyczyść' })).toBeFocused();
      await expectNoAxeViolations(page);
    });

    test('reading, analyzing and done', async ({ page, browser }) => {
      const pdf = await createSampleInvoicePdf(browser);
      const releaseWorker = await holdRequests(page, '**/pdf.worker*');
      let releaseAnalysis = () => {};
      const analysisReleased = new Promise<void>((resolve) => {
        releaseAnalysis = resolve;
      });
      await mockAnalyze(page, async (route) => {
        await analysisReleased;
        await respondWithResult(LONG_FILE_NAME)(route);
      });
      await page.goto('./');

      await choosePdf(page, LONG_FILE_NAME, pdf);
      await expect(page.getByText('Odczytywanie dokumentu…')).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page);

      releaseWorker();
      await expect(page.getByText('Analizowanie treści…')).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page);

      releaseAnalysis();
      const heading = page.getByRole('heading', {
        level: 2,
        name: 'Faktura VAT nr FV/2026/10/042',
      });
      await expect(heading).toBeFocused();
      await page.getByText('Pokaż podgląd JSON').click();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page);
    });

    test('error after a failed analysis', async ({ page, browser }) => {
      const pdf = await createSampleInvoicePdf(browser);
      await mockAnalyze(page, (route) =>
        route.fulfill({
          status: 502,
          headers: CORS_HEADERS,
          json: { error: { code: 'LLM_UNAVAILABLE', message: 'Upstream error' } },
        }),
      );
      await page.goto('./');

      await choosePdf(page, LONG_FILE_NAME, pdf);
      await expect(page.getByRole('alert')).toBeFocused();
      await expect(page.getByRole('button', { name: 'Spróbuj ponownie' })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page);
    });
  });
}

test('PDF without a text layer shows a clear error', async ({ page, browser }) => {
  const pdf = await createNoTextPdf(browser);
  await page.goto('./');
  await choosePdf(page, 'skan.pdf', pdf);
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('alert')).toContainText(/tekst/i);
});

test('full keyboard flow: upload, results, history', async ({ page, browser }) => {
  const pdf = await createSampleInvoicePdf(browser);
  let analyzeCalls = 0;
  await mockAnalyze(page, async (route) => {
    analyzeCalls++;
    await respondWithResult('faktura.pdf')(route);
  });
  await page.goto('./');

  // The dropzone is the first focusable element and opens the picker with Enter and Space.
  await page.keyboard.press('Tab');
  const dropzone = page.getByRole('button', { name: /Przeciągnij plik PDF/ });
  await expect(dropzone).toBeFocused();
  const spaceChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (await spaceChooser).setFiles([]);
  const enterChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (
    await enterChooser
  ).setFiles({ name: 'faktura.pdf', mimeType: 'application/pdf', buffer: pdf });

  await expect(page.getByRole('heading', { level: 2, name: /Faktura VAT/ })).toBeFocused();
  expect(analyzeCalls).toBe(1);

  // JSON preview, copy, download, then the result actions, in DOM order.
  await page.keyboard.press('Tab');
  await expect(page.getByText('Pokaż podgląd JSON')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Wynik analizy w formacie JSON' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Kopiuj JSON' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Pobierz JSON' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Analizuj inny plik' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Wróć do strony głównej' })).toBeFocused();

  // Back to the start: focus returns to the dropzone and the analysis is in the history.
  await page.keyboard.press('Enter');
  await expect(dropzone).toBeFocused();
  const entry = page.getByRole('button', { name: /^faktura\.pdf Faktura/ });
  await expect(entry).toBeVisible();

  // Opening it from the history does not call the API again.
  await page.keyboard.press('Tab');
  await expect(entry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: /Faktura VAT/ })).toBeFocused();
  expect(analyzeCalls).toBe(1);

  // Delete it with the keyboard; focus stays in the history section.
  await page.getByRole('button', { name: 'Wróć do strony głównej' }).press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Usuń z historii: faktura.pdf' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ostatnie analizy' })).toBeFocused();
  await expect(page.getByText('Brak zapisanych analiz.')).toBeVisible();
});

test('history can be cleared after a confirmation', async ({ page }) => {
  await seedHistory(page, ['a.pdf', 'b.pdf']);
  await page.goto('./');
  await expect(page.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Wyczyść historię' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Wyczyść historię' })).toBeFocused();
  await expect(page.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Wyczyść historię' }).click();
  await page.getByRole('button', { name: 'Tak, wyczyść' }).click();
  await expect(page.getByText('Brak zapisanych analiz.')).toBeVisible();
  // Not checked with a reload: the init script would seed the history again.
  expect(
    await page.evaluate(() => window.localStorage.getItem('pdf-insight:history:v1')),
  ).toBeNull();
});

test('spinner does not rotate with prefers-reduced-motion', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pdf = await createSampleInvoicePdf(browser);
  await mockAnalyze(page, () => new Promise<void>(() => {}));
  await page.goto('./');
  await choosePdf(page, 'faktura.pdf', pdf);
  const spinner = page.locator('.spinner');
  await expect(spinner).toBeVisible();
  expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
});
