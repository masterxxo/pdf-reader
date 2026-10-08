import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors';
import { geminiResponse, makeLlmAnalysis } from '../test/fixtures';
import { analyzeText, parseLlmOutput } from './analyze';
import { createGeminiClient } from './gemini';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function createClient(fetchMock: FetchMock, timeoutMs?: number) {
  return createGeminiClient({
    apiKey: 'test-secret-key',
    model: 'test-model',
    fetch: fetchMock,
    timeoutMs,
  });
}

interface SentBody {
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig: { responseMimeType: string; responseJsonSchema: Record<string, unknown> };
}

function sentBody(fetchMock: FetchMock, call: number): SentBody {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body)) as SentBody;
}

async function expectApiError(promise: Promise<unknown>, code: string) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseLlmOutput', () => {
  it('accepts valid JSON matching the schema', () => {
    const result = parseLlmOutput(JSON.stringify(makeLlmAnalysis()));
    expect(result).toEqual({ success: true, data: makeLlmAnalysis() });
  });

  it('reports invalid JSON', () => {
    expect(parseLlmOutput('{"summary": ')).toEqual({
      success: false,
      issues: ['The response is not valid JSON.'],
    });
  });

  it('reports schema issues with their paths', () => {
    const invalid = { ...makeLlmAnalysis(), dates: [{ date: '15.10.2026', context: 'x' }] };
    const result = parseLlmOutput(JSON.stringify(invalid));
    expect(result.success).toBe(false);
    expect(!result.success && result.issues[0]).toMatch(/^dates\.0\.date: /);
  });
});

describe('analyzeText with Gemini', () => {
  it('returns the analysis when the first response is valid', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(geminiResponse(JSON.stringify(makeLlmAnalysis()))),
    );

    await expect(analyzeText('Treść', createClient(fetchMock))).resolves.toEqual(makeLlmAnalysis());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('/models/test-model:generateContent');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-secret-key');
    const body = sentBody(fetchMock, 0);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toMatchObject({ type: 'object' });
    expect(body.generationConfig.responseJsonSchema).not.toHaveProperty('$schema');
  });

  it('retries once with the validation errors and returns the corrected result', async () => {
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse('{"summary": "niepełny'))
      .mockResolvedValueOnce(geminiResponse(JSON.stringify(makeLlmAnalysis())));

    await expect(analyzeText('Treść', createClient(fetchMock))).resolves.toEqual(makeLlmAnalysis());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retry = sentBody(fetchMock, 1).contents;
    expect(retry.map((message) => message.role)).toEqual(['user', 'model', 'user']);
    expect(retry[1]?.parts[0]?.text).toBe('{"summary": "niepełny');
    expect(retry[2]?.parts[0]?.text).toContain('The response is not valid JSON.');
  });

  it('fails with LLM_INVALID_OUTPUT after two invalid responses', async () => {
    const invalid = JSON.stringify({ ...makeLlmAnalysis(), keyPoints: [] });
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(geminiResponse(invalid)),
    );

    await expectApiError(analyzeText('Treść', createClient(fetchMock)), 'LLM_INVALID_OUTPUT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new ApiError('LLM_INVALID_OUTPUT').status).toBe(502);
  });

  it('treats an empty (e.g. blocked) response as invalid output', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } }))),
    );

    await expectApiError(analyzeText('Treść', createClient(fetchMock)), 'LLM_INVALID_OUTPUT');
    expect(sentBody(fetchMock, 1).contents[1]?.parts[0]?.text).toBe('(empty response)');
  });

  it('fails with LLM_TIMEOUT when Gemini does not answer in time', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );

    await expectApiError(analyzeText('Treść', createClient(fetchMock, 10)), 'LLM_TIMEOUT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with LLM_UNAVAILABLE on an upstream error without leaking its body', async () => {
    const upstreamBody = JSON.stringify({ error: { message: 'API key test-secret-key invalid' } });
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(upstreamBody, { status: 400 })),
    );

    const error: unknown = await analyzeText('Treść', createClient(fetchMock)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('LLM_UNAVAILABLE');
    expect((error as ApiError).message).not.toContain('test-secret-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with LLM_UNAVAILABLE on a network error', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    await expectApiError(analyzeText('Treść', createClient(fetchMock)), 'LLM_UNAVAILABLE');
  });
});
