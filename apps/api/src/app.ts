import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from './env';
import { ApiError, toErrorBody } from './errors';
import { corsMiddleware } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { createAnalyzeHandler, type AnalyzeHandlerOptions } from './routes/analyze';

/** Only extracted text is sent, so 1 MB comfortably fits MAX_TEXT_CHARS. */
export const MAX_BODY_BYTES = 1024 * 1024;

export function createApp(options: AnalyzeHandlerOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use('*', corsMiddleware);

  app.get('/health', (c) => c.json({ ok: true }));

  app.post(
    '/analyze',
    rateLimitMiddleware,
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new ApiError('TEXT_TOO_LONG');
      },
    }),
    createAnalyzeHandler(options),
  );

  app.notFound((c) => {
    const error = new ApiError('NOT_FOUND');
    return c.json(toErrorBody(error), error.status);
  });

  // Unknown errors become INTERNAL; details (and upstream bodies) are never exposed.
  app.onError((err, c) => {
    const error = err instanceof ApiError ? err : new ApiError('INTERNAL', { cause: err });
    return c.json(toErrorBody(error), error.status);
  });

  return app;
}
