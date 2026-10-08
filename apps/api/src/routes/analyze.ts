import { AnalysisResultSchema, AnalyzeRequestSchema, type LlmAnalysis } from '@pdf-insight/shared';
import type { Context } from 'hono';
import { parseMaxTextChars } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { CACHE_HEADER, PROVIDER_HEADER } from '../headers';
import { analyzeDocument } from '../lib/analyze';
import { analysisCacheKey, readCachedAnalysis, writeCachedAnalysis } from '../lib/cache';
import { ProviderChain, type ProviderChainOptions } from '../lib/llm/chain';
import { estimateTokens } from '../lib/metrics';
import { createGeminiProvider } from '../lib/llm/gemini';
import { createMistralProvider } from '../lib/llm/mistral';
import type { LlmProvider } from '../lib/llm/types';

export interface AnalyzeHandlerOptions {
  /** Overrides the providers (tests). Defaults to Mistral, then Gemini as a fallback. */
  createProviders?: (env: AppEnv['Bindings']) => LlmProvider[];
  /** Overrides chain settings (tests use an instant sleep). */
  chain?: ProviderChainOptions;
}

/** Providers in order of preference; one without an API key is skipped. */
function defaultCreateProviders(env: AppEnv['Bindings']): LlmProvider[] {
  const providers: LlmProvider[] = [];
  if (env.MISTRAL_API_KEY && env.MISTRAL_MODEL) {
    providers.push(
      createMistralProvider({ apiKey: env.MISTRAL_API_KEY, model: env.MISTRAL_MODEL }),
    );
  }
  if (env.LLM_API_KEY && env.LLM_MODEL) {
    providers.push(createGeminiProvider({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL }));
  }
  return providers;
}

export function createAnalyzeHandler(options: AnalyzeHandlerOptions = {}) {
  const createProviders = options.createProviders ?? defaultCreateProviders;

  return async (c: Context<AppEnv>) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      throw new ApiError('INVALID_REQUEST', { cause: error });
    }

    const request = AnalyzeRequestSchema.safeParse(body);
    if (!request.success) {
      throw new ApiError('INVALID_REQUEST', { cause: request.error });
    }
    const { fileName, pages, text } = request.data;
    const metrics = c.get('metrics');
    metrics.size('chars', text.length);
    metrics.size('estTokens', estimateTokens(text));
    metrics.size('pages', pages);

    if (text.length > parseMaxTextChars(c.env.MAX_TEXT_CHARS)) {
      throw new ApiError('TEXT_TOO_LONG');
    }

    // fileName and pages come from the client, never from the model or the cache.
    const respond = (analysis: LlmAnalysis, provider: string, cache: 'HIT' | 'MISS') => {
      const result = AnalysisResultSchema.safeParse({
        ...analysis,
        document: { ...analysis.document, fileName, pages },
      });
      if (!result.success) {
        throw new ApiError('INTERNAL', { cause: result.error });
      }
      c.header(PROVIDER_HEADER, provider);
      c.header(CACHE_HEADER, cache);
      return c.json(result.data);
    };

    const cacheKey = await analysisCacheKey(text);
    const cached = await readCachedAnalysis(c.env.ANALYSIS_CACHE, cacheKey);
    if (cached) {
      return respond(cached.analysis, cached.provider, 'HIT');
    }

    const llm = new ProviderChain(createProviders(c.env), { ...options.chain, metrics });
    const analysis = await analyzeDocument(text, llm, { signal: c.req.raw.signal, metrics });
    // Set whenever the chain returned output, which analyzeDocument requires.
    const provider = llm.lastProvider ?? 'unknown';

    const response = respond(analysis, provider, 'MISS');
    await writeCachedAnalysis(c.env.ANALYSIS_CACHE, cacheKey, { analysis, provider });
    return response;
  };
}
