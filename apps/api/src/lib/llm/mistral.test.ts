import { describe, expect, it, vi } from 'vitest';
import { mistralResponse } from '../../test/fixtures';
import { parseRetryAfter } from './http';
import { createMistralProvider } from './mistral';
import { LlmProviderError } from './types';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const PROMPT = {
  systemInstruction: 'System',
  messages: [
    { role: 'user', text: 'Pytanie' },
    { role: 'assistant', text: 'nie JSON' },
    { role: 'user', text: 'Popraw' },
  ],
} as const;
const SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };

function createProvider(fetchMock: FetchMock) {
  return createMistralProvider({
    apiKey: 'test-mistral-key',
    model: 'test-model',
    fetch: fetchMock,
  });
}

async function providerError(promise: Promise<unknown>): Promise<LlmProviderError> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LlmProviderError);
  return error as LlmProviderError;
}

describe('createMistralProvider', () => {
  it('sends a strict json_schema request and returns the message content', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(mistralResponse('{"a":1}')),
    );

    await expect(createProvider(fetchMock).generate(PROMPT, SCHEMA)).resolves.toBe('{"a":1}');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-mistral-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Pytanie' },
        { role: 'assistant', content: 'nie JSON' },
        { role: 'user', content: 'Popraw' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'document_analysis', schema: { type: 'object' }, strict: true },
      },
    });
    expect(String(init?.body)).not.toContain('$schema');
  });

  it('joins text chunks and skips thinking chunks', async () => {
    const body = {
      choices: [
        {
          message: {
            content: [
              { type: 'thinking', thinking: [{ type: 'text', text: 'hmm' }] },
              { type: 'text', text: '{"a":' },
              { type: 'text', text: '1}' },
            ],
          },
        },
      ],
    };
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(body))),
    );

    await expect(createProvider(fetchMock).generate(PROMPT, SCHEMA)).resolves.toBe('{"a":1}');
  });

  it('returns "" for a response without content', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ choices: [] }))),
    );
    await expect(createProvider(fetchMock).generate(PROMPT, SCHEMA)).resolves.toBe('');
  });

  it('reports 429 as a rate limit that allows fallback, with Retry-After', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })),
    );

    const error = await providerError(createProvider(fetchMock).generate(PROMPT, SCHEMA));
    expect(error).toMatchObject({ code: 'RATE_LIMITED', canFallback: true, retryAfterMs: 1000 });
  });

  it.each([
    [500, true],
    [503, true],
    [400, false],
    [401, false],
  ])('maps HTTP %i to LLM_UNAVAILABLE (fallback: %s)', async (status, canFallback) => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('upstream details', { status })),
    );

    const error = await providerError(createProvider(fetchMock).generate(PROMPT, SCHEMA));
    expect(error).toMatchObject({ code: 'LLM_UNAVAILABLE', canFallback });
    expect(error.message).not.toContain('upstream details');
  });

  it('maps a timeout to LLM_TIMEOUT that allows fallback', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );
    const provider = createMistralProvider({
      apiKey: 'k',
      model: 'm',
      fetch: fetchMock,
      timeoutMs: 10,
    });

    const error = await providerError(provider.generate(PROMPT, SCHEMA));
    expect(error).toMatchObject({ code: 'LLM_TIMEOUT', canFallback: true });
  });

  it('does not allow fallback when the caller aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock: FetchMock = vi.fn<typeof fetch>((_url, init) =>
      Promise.reject(init?.signal?.reason ?? new Error('aborted')),
    );

    const error = await providerError(
      createProvider(fetchMock).generate(PROMPT, SCHEMA, controller.signal),
    );
    expect(error.canFallback).toBe(false);
  });

  it('maps a network error to LLM_UNAVAILABLE that allows fallback', async () => {
    const fetchMock: FetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    const error = await providerError(createProvider(fetchMock).generate(PROMPT, SCHEMA));
    expect(error).toMatchObject({ code: 'LLM_UNAVAILABLE', canFallback: true });
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');

  it.each([
    [null, undefined],
    ['', undefined],
    ['2', 2000],
    ['0.5', 500],
    ['-1', undefined],
    ['Thu, 08 Oct 2026 12:00:03 GMT', 3000],
    ['Thu, 08 Oct 2026 11:59:00 GMT', 0],
    ['soon', undefined],
  ])('parses %s', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });
});
