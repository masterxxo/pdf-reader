import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // '/' locally, '/<repo>/' on GitHub Pages (set by CI).
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    // Must stay 5173: it is the localhost origin allowed by the API's CORS.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
