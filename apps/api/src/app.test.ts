import { ApiErrorResponseSchema } from '@pdf-insight/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, createApp } from './app';
import type { Env } from './env';
import { CACHE_TTL_SECONDS } from './lib/cache';
import {
  createMemoryKv,
  geminiResponse,
  isGeminiUrl,
  isMistralUrl,
  makeEnv,
  makeLlmAnalysis,
  mistralResponse,
} from './test/fixtures';

const app = createApp();
const ALLOWED_ORIGIN = 'https://masterxxo.github.io';
const validRequest = { fileName: 'faktura.pdf', pages: 2, text: '--- Strona 1 ---\nFaktura' };

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>((url) => {
    const output = JSON.stringify(makeLlmAnalysis());
    return Promise.resolve(isMistralUrl(url) ? mistralResponse(output) : geminiResponse(output));
  });
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
    expect(response.headers.get('X-LLM-Provider')).toBe('mistral');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-LLM-Provider');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends normalized text (no page markers or page numbers) to the model', async () => {
    const text = '--- Strona 1 ---\nFaktura   VAT\n1\n\n--- Strona 2 ---\nRazem: 100 zł\n2';
    const response = await postAnalyze({ ...validRequest, text });

    expect(response.status).toBe(200);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    const prompt = body.messages.find((message) => message.role === 'user')?.content ?? '';
    expect(prompt).toContain('<document>\nFaktura VAT\n\nRazem: 100 zł\n</document>');
    expect(response.headers.get('Server-Timing')).toMatch(/chars=\d+ normalizedChars=\d+/);
  });

  it('falls back to Gemini when Mistral is rate limited', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        isMistralUrl(url)
          ? new Response('quota details', { status: 429 })
          : geminiResponse(JSON.stringify(makeLlmAnalysis())),
      ),
    );
    const response = await postAnalyze(validRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get('X-LLM-Provider')).toBe('gemini');
    expect(fetchMock.mock.calls.map(([url]) => isGeminiUrl(url))).toEqual([false, true]);
  });

  it('uses only Gemini when no Mistral key is configured', async () => {
    const response = await postAnalyze(validRequest, makeEnv({ MISTRAL_API_KEY: '' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-LLM-Provider')).toBe('gemini');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores fileName and pages produced by the model', async () => {
    const llmOutput = {
      ...makeLlmAnalysis(),
      document: { ...makeLlmAnalysis().document, fileName: 'hacked.pdf', pages: 99 },
    };
    fetchMock.mockResolvedValue(mistralResponse(JSON.stringify(llmOutput)));

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
    fetchMock.mockImplementation(() => Promise.resolve(mistralResponse('nie JSON')));
    const response = await postAnalyze(validRequest);
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe('LLM_INVALID_OUTPUT');
    // Invalid output is retried on the same provider, never on the fallback.
    expect(fetchMock.mock.calls.map(([url]) => isMistralUrl(url))).toEqual([true, true]);
  });

  it('returns 502 LLM_UNAVAILABLE when both providers fail, without leaking bodies or keys', async () => {
    fetchMock.mockResolvedValue(new Response('upstream secret details', { status: 500 }));
    const response = await postAnalyze(validRequest);
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain('LLM_UNAVAILABLE');
    expect(text).not.toContain('upstream secret details');
    expect(text).not.toContain('test-secret-key');
    expect(text).not.toContain('test-mistral-key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns 429 RATE_LIMITED when both provider quotas are exceeded', async () => {
    fetchMock.mockResolvedValue(new Response('quota details', { status: 429 }));
    const response = await postAnalyze(validRequest);

    expect(response.status).toBe(429);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(await errorCode(response)).toBe('RATE_LIMITED');
  });

  it('returns 500 INTERNAL when no API key is configured', async () => {
    const env = makeEnv({ MISTRAL_API_KEY: '', LLM_API_KEY: '' });
    const response = await postAnalyze(validRequest, env);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe('INTERNAL');
  });
});

describe('analysis cache', () => {
  function envWithCache(overrides: Partial<Env> = {}) {
    const cache = createMemoryKv();
    return { env: makeEnv({ ANALYSIS_CACHE: cache.kv, ...overrides }), cache };
  }

  it('stores a miss and serves the same text from the cache with the new fileName and pages', async () => {
    const { env, cache } = envWithCache();

    const first = await postAnalyze(validRequest, env);
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    expect(first.headers.get('X-LLM-Provider')).toBe('mistral');

    const second = await postAnalyze({ ...validRequest, fileName: 'kopia.pdf', pages: 3 }, env);
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(second.headers.get('X-LLM-Provider')).toBe('mistral');
    expect(second.headers.get('Access-Control-Expose-Headers')).toContain('X-Cache');
    expect(await second.json()).toEqual({
      ...makeLlmAnalysis(),
      document: { ...makeLlmAnalysis().document, fileName: 'kopia.pdf', pages: 3 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.entries.size).toBe(1);
  });

  it('stores only the model output, with a 7-day TTL and the provider in metadata', async () => {
    const { env, cache } = envWithCache();
    await postAnalyze(validRequest, env);

    const [key, entry] = [...cache.entries][0] ?? [];
    expect(key).toMatch(/^analysis:v1:[0-9a-f]{64}$/);
    expect(JSON.parse(entry?.value ?? '')).toEqual(makeLlmAnalysis());
    expect(entry?.metadata).toEqual({ provider: 'mistral' });
    expect(entry?.expirationTtl).toBe(CACHE_TTL_SECONDS);
    expect(CACHE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('remembers the fallback provider of a cached result', async () => {
    const { env } = envWithCache({ MISTRAL_API_KEY: '' });
    await postAnalyze(validRequest, env);

    const hit = await postAnalyze(validRequest, makeEnv({ ANALYSIS_CACHE: env.ANALYSIS_CACHE }));
    expect(hit.headers.get('X-Cache')).toBe('HIT');
    expect(hit.headers.get('X-LLM-Provider')).toBe('gemini');
  });

  it('does not depend on the model', async () => {
    const { env } = envWithCache();
    await postAnalyze(validRequest, env);

    const hit = await postAnalyze(validRequest, { ...env, MISTRAL_MODEL: 'other-model' });
    expect(hit.headers.get('X-Cache')).toBe('HIT');
  });

  it('misses for a different text', async () => {
    const { env, cache } = envWithCache();
    await postAnalyze(validRequest, env);

    const other = await postAnalyze({ ...validRequest, text: 'Inny dokument' }, env);
    expect(other.headers.get('X-Cache')).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.entries.size).toBe(2);
  });

  it('treats an entry that no longer matches the schema as a miss', async () => {
    const { env, cache } = envWithCache();
    await postAnalyze(validRequest, env);
    for (const entry of cache.entries.values()) {
      entry.value = JSON.stringify({ summary: 'stary format' });
    }

    const response = await postAnalyze(validRequest, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('still answers when KV fails', async () => {
    const broken = {
      getWithMetadata: () => Promise.reject(new Error('KV down')),
      put: () => Promise.reject(new Error('KV down')),
    } as unknown as KVNamespace;

    const response = await postAnalyze(validRequest, makeEnv({ ANALYSIS_CACHE: broken }));
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('MISS');
  });

  it('does not cache errors', async () => {
    const { env, cache } = envWithCache();
    fetchMock.mockImplementation(() => Promise.resolve(mistralResponse('nie JSON')));

    const response = await postAnalyze(validRequest, env);
    expect(response.status).toBe(502);
    expect(cache.entries.size).toBe(0);
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
