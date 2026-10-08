import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** Same base path as on GitHub Pages, so the pdf.js worker URL is tested under it too. */
export const BASE_PATH = '/pdf-reader/';
/** Never reached: every request to it is mocked in the tests. */
export const MOCK_API_URL = 'https://api.example.test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}${BASE_PATH}`,
    ...devices['Desktop Chrome'],
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}${BASE_PATH}`,
        env: { VITE_BASE: BASE_PATH, VITE_API_URL: MOCK_API_URL },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
