import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { parseAllowedOrigins } from '../config';
import type { AppEnv } from '../env';
import { EXPOSED_HEADERS } from '../headers';

/**
 * CORS with an exact-match origin allowlist from ALLOWED_ORIGINS. A foreign
 * origin gets no Access-Control-Allow-Origin header, so the browser blocks it.
 */
export const corsMiddleware = createMiddleware<AppEnv>((c, next) => {
  const allowedOrigins = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);
  const handler = cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: EXPOSED_HEADERS,
    maxAge: 86_400,
  });
  return handler(c, next);
});
