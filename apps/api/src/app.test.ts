import { ApiErrorResponseSchema } from '@pdf-insight/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, createApp } from './app';
import type { Env } from './env';
import { geminiResponse, makeEnv, makeLlmAnalysis } from './test/fixtures';

const app = createApp();
const ALLOWED_ORIGIN = 'https://masterxxo.github.io';
const validRequest = { fileName: 'faktura.pdf', pages: 2, text: '--- Strona 1 ---\nFaktura' };

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(geminiResponse(JSON.stringify(makeLlmAnalysis()))),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function postAnalyze(body: unknown, env: Env = makeEnv(), headers: Record<string, string> = {}) {
  return app.request(
    '/analyze',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  );
}

/** Asserts the shared error shape and returns its code. */
async function errorCode(response: Response): Promise<string> {
  const body = ApiErrorResponseSchema.parse(await response.json());
  expect(body.error.message.length).toBeGreaterThan(0);
  return body.error.code;
}

describe('POST /analyze', () => {
  it('returns the analysis with fileName and pages from the request', async () => {
    const response = await postAnalyze(validRequest);

    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toEqual({
      ...makeLlmAnalysis(),
      document: { ...makeLlmAnalysis().document, fileName: 'faktura.pdf', pages: 2 },
    });
  });

  it('ignores fileName and pages produced by the model', async () => {
    const llmOutput = {
      ...makeLlmAnalysis(),
      document: { ...makeLlmAnalysis().document, fileName: 'hacked.pdf', pages: 99 },
    };
    fetchMock.mockResolvedValue(geminiResponse(JSON.stringify(llmOutput)));

    const result = (await (await postAnalyze(validRequest)).json()) as {
      document: { fileName: string; pages: number };
    };
    expect(result.document).toMatchObject({ fileName: 'faktura.pdf', pages: 2 });
  });

  it.each([
    ['malformed JSON', '{"fileName":'],
    ['missing text', { fileName: 'a.pdf', pages: 1 }],
    ['empty text', { ...validRequest, text: '   ' }],
    ['non-integer pages', { ...validRequest, pages: 1.5 }],
    ['zero pages', { ...validRequest, pages: 0 }],
    ['empty file name', { ...validRequest, fileName: '' }],
  ])('rejects %s with 400 INVALID_REQUEST', async (_name, body) => {
    const response = await postAnalyze(body);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects text longer than MAX_TEXT_CHARS with 413 TEXT_TOO_LONG', async () => {
    const response = await postAnalyze({ ...validRequest, text: 'a'.repeat(1001) });
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('TEXT_TOO_LONG');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a body over the size limit with 413 TEXT_TOO_LONG', async () => {
    const text = 'a'.repeat(MAX_BODY_BYTES + 1);
    const response = await postAnalyze({ ...validRequest, text }, makeEnv({ MAX_TEXT_CHARS: '' }));
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('TEXT_TOO_LONG');
  });

  it('returns 429 RATE_LIMITED keyed by CF-Connecting-IP', async () => {
    const limit = vi.fn<RateLimit['limit']>(() => Promise.resolve({ success: false }));
    const env = makeEnv({ ANALYZE_RATE_LIMITER: { limit } });

    const response = await postAnalyze(validRequest, env, { 'CF-Connecting-IP': '203.0.113.7' });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(await errorCode(response)).toBe('RATE_LIMITED');
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 LLM_INVALID_OUTPUT after two invalid model responses', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(geminiResponse('nie JSON')));
    const response = await postAnalyze(validRequest);
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe('LLM_INVALID_OUTPUT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns 502 LLM_UNAVAILABLE without leaking the upstream body or key', async () => {
    fetchMock.mockResolvedValue(new Response('upstream secret details', { status: 500 }));
    const response = await postAnalyze(validRequest);
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain('LLM_UNAVAILABLE');
    expect(text).not.toContain('upstream secret details');
    expect(text).not.toContain('test-secret-key');
  });

  it('returns 429 RATE_LIMITED when the Gemini quota is exceeded', async () => {
    fetchMock.mockResolvedValue(new Response('quota details', { status: 429 }));
    const response = await postAnalyze(validRequest);

    expect(response.status).toBe(429);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(await errorCode(response)).toBe('RATE_LIMITED');
  });

  it('returns 500 INTERNAL when the API key is not configured', async () => {
    const response = await postAnalyze(validRequest, makeEnv({ LLM_API_KEY: '' }));
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe('INTERNAL');
  });
});

describe('CORS', () => {
  function preflight(origin: string) {
    return app.request(
      '/analyze',
      {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      makeEnv(),
    );
  }

  it.each([ALLOWED_ORIGIN, 'http://localhost:5173'])('allows %s', async (origin) => {
    const response = await preflight(origin);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST');
  });

  it.each([
    'https://evil.example',
    'https://masterxxo.github.io.evil.example',
    'http://masterxxo.github.io',
    'http://localhost:3000',
  ])('rejects foreign origin %s', async (origin) => {
    const response = await preflight(origin);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const post = await postAnalyze(validRequest, makeEnv(), { Origin: origin });
    expect(post.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('other routes', () => {
  it('GET /health returns ok', async () => {
    const response = await app.request('/health', {}, makeEnv());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each([
    ['GET', '/analyze'],
    ['POST', '/health'],
    ['GET', '/unknown'],
  ])('%s %s returns 404 NOT_FOUND', async (method, path) => {
    const response = await app.request(path, { method }, makeEnv());
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('NOT_FOUND');
  });
});
