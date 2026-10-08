import type { AnalysisResult } from '@pdf-insight/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeDocument } from './client';
import { AnalysisError } from './errors';

const API_URL = 'https://api.example.dev';
const request = { fileName: 'umowa.pdf', pages: 2, text: '--- Strona 1 ---\nUmowa' };

function makeResult(): AnalysisResult {
  return {
    document: {
      fileName: 'umowa.pdf',
      pages: 2,
      language: 'pl',
      type: 'contract',
      title: 'Umowa o dzieło',
      date: '2026-09-30',
    },
    summary: 'Umowa o dzieło między dwiema stronami.',
    keyPoints: ['Wykonanie strony internetowej'],
    entities: { organizations: [], people: ['Anna Nowak'] },
    amounts: [{ value: 5000, currency: 'PLN', context: 'Wynagrodzenie' }],
    dates: [],
    keywords: ['umowa'],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(makeResult())));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function expectAnalysisError(promise: Promise<unknown>, code: string) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AnalysisError);
  expect((error as AnalysisError).code).toBe(code);
}

describe('analyzeDocument', () => {
  it('posts the request to /analyze and returns the validated result', async () => {
    await expect(analyzeDocument(request, { apiUrl: `${API_URL}/` })).resolves.toEqual(
      makeResult(),
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API_URL}/analyze`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it.each([
    ['a missing field', { ...makeResult(), summary: undefined }],
    ['an invalid date', { ...makeResult(), dates: [{ date: '30.09.2026', context: 'x' }] }],
    [
      'an invalid currency',
      { ...makeResult(), amounts: [{ value: 1, currency: 'zł', context: '' }] },
    ],
    [
      'an unknown document type',
      { ...makeResult(), document: { ...makeResult().document, type: 'x' } },
    ],
    ['a non-object body', 'ok'],
  ])('rejects a response with %s', async (_name, body) => {
    fetchMock.mockResolvedValue(jsonResponse(body));
    await expectAnalysisError(analyzeDocument(request, { apiUrl: API_URL }), 'INVALID_RESPONSE');
  });

  it('rejects a non-JSON success response', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>', { status: 200 }));
    await expectAnalysisError(analyzeDocument(request, { apiUrl: API_URL }), 'INVALID_RESPONSE');
  });

  it('uses the error code from an API error response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'LLM_INVALID_OUTPUT', message: 'x' } }, 502),
    );
    await expectAnalysisError(analyzeDocument(request, { apiUrl: API_URL }), 'LLM_INVALID_OUTPUT');
  });

  it('falls back to the HTTP status for an unrecognized error body', async () => {
    fetchMock.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));
    await expectAnalysisError(analyzeDocument(request, { apiUrl: API_URL }), 'RATE_LIMITED');
  });

  it('maps a failed fetch (network or CORS) to NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expectAnalysisError(analyzeDocument(request, { apiUrl: API_URL }), 'NETWORK_ERROR');
  });

  it('fails with MISSING_API_URL without calling fetch', async () => {
    await expectAnalysisError(analyzeDocument(request, { apiUrl: '  ' }), 'MISSING_API_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rethrows the AbortError when the caller aborts', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const controller = new AbortController();
    const promise = analyzeDocument(request, { apiUrl: API_URL, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fails with CLIENT_TIMEOUT when the server does not answer in time', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );
    await expectAnalysisError(
      analyzeDocument(request, { apiUrl: API_URL, timeoutMs: 10 }),
      'CLIENT_TIMEOUT',
    );
  });
});
