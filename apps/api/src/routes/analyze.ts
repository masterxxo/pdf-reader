import { AnalysisResultSchema, AnalyzeRequestSchema } from '@pdf-insight/shared';
import type { Context } from 'hono';
import { parseMaxTextChars } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { analyzeDocument } from '../lib/analyze';
import { createGeminiClient, type GenerateJson } from '../lib/gemini';

export interface AnalyzeHandlerOptions {
  /** Overrides the LLM client (tests). Defaults to Gemini configured from env. */
  createLlm?: (env: AppEnv['Bindings']) => GenerateJson;
}

function defaultCreateLlm(env: AppEnv['Bindings']): GenerateJson {
  if (!env.LLM_API_KEY || !env.LLM_MODEL) {
    throw new ApiError('INTERNAL', { cause: new Error('LLM is not configured') });
  }
  return createGeminiClient({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
}

export function createAnalyzeHandler(options: AnalyzeHandlerOptions = {}) {
  const createLlm = options.createLlm ?? defaultCreateLlm;

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

    const analysis = await analyzeDocument(text, createLlm(c.env));

    // fileName and pages come from the client, never from the model.
    const result = AnalysisResultSchema.safeParse({
      ...analysis,
      document: { ...analysis.document, fileName, pages },
    });
    if (!result.success) {
      throw new ApiError('INTERNAL', { cause: result.error });
    }
    return c.json(result.data);
  };
}
