import { AnalysisResultSchema, AnalyzeRequestSchema } from '@pdf-insight/shared';
import type { Context } from 'hono';
import { parseMaxTextChars } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { PROVIDER_HEADER } from '../headers';
import { analyzeDocument } from '../lib/analyze';
import { ProviderChain, type ProviderChainOptions } from '../lib/llm/chain';
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

    if (text.length > parseMaxTextChars(c.env.MAX_TEXT_CHARS)) {
      throw new ApiError('TEXT_TOO_LONG');
    }

    const llm = new ProviderChain(createProviders(c.env), options.chain);
    const analysis = await analyzeDocument(text, llm, c.req.raw.signal);

    // fileName and pages come from the client, never from the model.
    const result = AnalysisResultSchema.safeParse({
      ...analysis,
      document: { ...analysis.document, fileName, pages },
    });
    if (!result.success) {
      throw new ApiError('INTERNAL', { cause: result.error });
    }
    c.header(PROVIDER_HEADER, llm.lastProvider);
    return c.json(result.data);
  };
}
