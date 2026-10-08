import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from './env';
import { ApiError, toErrorBody } from './errors';
import { SERVER_TIMING_HEADER } from './headers';
import { RequestMetrics, createDebugLog } from './lib/metrics';
import { corsMiddleware } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { createAnalyzeHandler, type AnalyzeHandlerOptions } from './routes/analyze';

/**
 * Only extracted text is sent. 1 MB is several times more than the longest
 * document that can be analyzed in time (rejected later as TEXT_TOO_LONG).
 */
export const MAX_BODY_BYTES = 1024 * 1024;

export function createApp(options: AnalyzeHandlerOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use('*', corsMiddleware);

  app.get('/health', (c) => c.json({ ok: true }));

  app.post(
    '/analyze',
    // First, so timings cover the whole request and are added to error responses too.
    async (c, next) => {
      const metrics = new RequestMetrics({ log: createDebugLog(c.env.DEBUG === '1') });
      c.set('metrics', metrics);
      await next();
      c.res.headers.set(SERVER_TIMING_HEADER, metrics.toServerTiming());
      metrics.log('response', { status: c.res.status, totalMs: metrics.elapsedMs() });
    },
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
