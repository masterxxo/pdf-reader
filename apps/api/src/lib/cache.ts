import { LlmAnalysisSchema, llmAnalysisJsonSchema, type LlmAnalysis } from '@pdf-insight/shared';
import { z } from 'zod';
import { SYSTEM_INSTRUCTION, buildUserPrompt } from './prompt';

/** Cached results expire after 7 days. */
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const KEY_PREFIX = 'analysis:v1:';

export interface CachedAnalysis {
  analysis: LlmAnalysis;
  /** Provider that produced the result, kept in KV metadata (not in the result). */
  provider: string;
}

const MetadataSchema = z.object({ provider: z.string().min(1) });

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of the prompt version and the text. The version is the system
 * instruction, the output schema and the user prompt template themselves, so
 * changing any of them invalidates old entries. The model is deliberately not
 * part of the key: results from Mistral and Gemini are interchangeable.
 */
export async function analysisCacheKey(text: string): Promise<string> {
  const input = JSON.stringify([SYSTEM_INSTRUCTION, llmAnalysisJsonSchema, buildUserPrompt(text)]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return KEY_PREFIX + toHex(digest);
}

/**
 * Returns the cached analysis, or null on a miss. The cache is best-effort:
 * read errors and entries that no longer match the schema count as misses.
 */
export async function readCachedAnalysis(
  kv: KVNamespace,
  key: string,
): Promise<CachedAnalysis | null> {
  try {
    const { value, metadata } = await kv.getWithMetadata(key, 'json');
    const analysis = LlmAnalysisSchema.safeParse(value);
    const meta = MetadataSchema.safeParse(metadata);
    if (!analysis.success || !meta.success) {
      return null;
    }
    return { analysis: analysis.data, provider: meta.data.provider };
  } catch {
    return null;
  }
}

/** Stores the analysis; a failed write must not fail the request. */
export async function writeCachedAnalysis(
  kv: KVNamespace,
  key: string,
  entry: CachedAnalysis,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(entry.analysis), {
      expirationTtl: CACHE_TTL_SECONDS,
      metadata: { provider: entry.provider },
    });
  } catch {
    // Best-effort: the result is still returned, just not cached.
  }
}
