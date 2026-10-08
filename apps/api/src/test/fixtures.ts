import type { LlmAnalysis } from '@pdf-insight/shared';
import { expect } from 'vitest';
import type { Env } from '../env';

export function makeLlmAnalysis(): LlmAnalysis {
  return {
    document: { language: 'pl', type: 'invoice', title: 'Faktura VAT 1/2026', date: '2026-10-01' },
    summary: 'Faktura za usługi programistyczne. Termin płatności to 15 października 2026.',
    keyPoints: ['Usługi programistyczne', 'Termin płatności 14 dni', 'Płatność przelewem'],
    entities: { organizations: ['ACME Sp. z o.o.'], people: ['Jan Kowalski'] },
    amounts: [{ value: 12500, currency: 'PLN', context: 'Razem netto' }],
    dates: [{ date: '2026-10-15', context: 'Termin płatności' }],
    keywords: ['faktura'],
  };
}

/** A Gemini generateContent response whose text part is `text`. */
export function geminiResponse(text: string, init: ResponseInit = {}): Response {
  const body = { candidates: [{ content: { role: 'model', parts: [{ text }] } }] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** A Mistral chat completion response whose message content is `text`. */
export function mistralResponse(text: string, init: ResponseInit = {}): Response {
  const body = {
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

export const isMistralUrl = (url: unknown) => String(url).startsWith('https://api.mistral.ai/');
export const isGeminiUrl = (url: unknown) =>
  String(url).startsWith('https://generativelanguage.googleapis.com/');

export interface MemoryKv {
  kv: KVNamespace;
  entries: Map<string, { value: string; metadata: unknown; expirationTtl: number | undefined }>;
}

/** An in-memory stand-in for the parts of KVNamespace the API uses. */
export function createMemoryKv(): MemoryKv {
  const entries: MemoryKv['entries'] = new Map();
  const fake = {
    getWithMetadata: (key: string, type: 'json') => {
      expect(type).toBe('json');
      const entry = entries.get(key);
      return Promise.resolve({
        value: entry ? (JSON.parse(entry.value) as unknown) : null,
        metadata: entry?.metadata ?? null,
        cacheStatus: null,
      });
    },
    put: (key: string, value: string, options: KVNamespacePutOptions = {}) => {
      entries.set(key, { value, metadata: options.metadata, expirationTtl: options.expirationTtl });
      return Promise.resolve();
    },
  };
  return { kv: fake as unknown as KVNamespace, entries };
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MISTRAL_API_KEY: 'test-mistral-key',
    MISTRAL_MODEL: 'test-mistral-model',
    LLM_API_KEY: 'test-secret-key',
    LLM_MODEL: 'test-model',
    ALLOWED_ORIGINS: 'https://masterxxo.github.io,http://localhost:5173',
    MAX_TEXT_CHARS: '1000',
    ANALYZE_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
    ANALYSIS_CACHE: createMemoryKv().kv,
    ...overrides,
  };
}
