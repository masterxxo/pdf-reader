import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { ApiError, toErrorBody } from '../errors';

/** Matches the period of the rate limiting binding in wrangler.toml. */
const RATE_LIMIT_PERIOD_SECONDS = 60;

/** Per-IP rate limiting via the Workers Rate Limiting binding. */
export const rateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // Set by Cloudflare on every request; absent only in local tooling.
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await c.env.ANALYZE_RATE_LIMITER.limit({ key: ip });
  if (!success) {
    const error = new ApiError('RATE_LIMITED');
    return c.json(toErrorBody(error), error.status, {
      'Retry-After': String(RATE_LIMIT_PERIOD_SECONDS),
    });
  }
  await next();
});
