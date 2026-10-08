import { LlmAnalysisSchema, llmAnalysisJsonSchema, type LlmAnalysis } from '@pdf-insight/shared';
import { ApiError } from '../errors';
import type { ProviderChain } from './llm/chain';
import type { ChatMessage } from './llm/types';
import type { RequestMetrics } from './metrics';
import {
  SYSTEM_INSTRUCTION,
  buildCorrectionPrompt,
  buildUserPrompt,
  type DocumentPart,
} from './prompt';

/** Limits how many validation issues are sent back to the model. */
const MAX_REPORTED_ISSUES = 20;

export type ParseResult =
  | { success: true; data: LlmAnalysis }
  | { success: false; reason: 'invalid_json' | 'invalid_schema'; issues: string[] };

/** Parses and validates raw model output against LlmAnalysisSchema. */
export function parseLlmOutput(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { success: false, reason: 'invalid_json', issues: ['The response is not valid JSON.'] };
  }

  const result = LlmAnalysisSchema.safeParse(json);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return { success: false, reason: 'invalid_schema', issues };
}

export type LlmClient = Pick<ProviderChain, 'generate'>;

export interface AnalyzeOptions {
  part?: DocumentPart;
  signal?: AbortSignal;
  metrics?: RequestMetrics;
}

/**
 * Analyzes one piece of text (a whole document or, later, a single chunk).
 * Invalid output is retried exactly once, with the validation errors sent
 * back to the model; a second failure is an LLM_INVALID_OUTPUT error.
 */
export async function analyzeText(
  text: string,
  llm: LlmClient,
  options: AnalyzeOptions = {},
): Promise<LlmAnalysis> {
  const { part, signal, metrics } = options;
  const messages: ChatMessage[] = [{ role: 'user', text: buildUserPrompt(text, part) }];
  const request = (isRetry: boolean) =>
    llm.generate({ systemInstruction: SYSTEM_INSTRUCTION, messages }, llmAnalysisJsonSchema, {
      signal,
      isRetry,
    });

  const parse = (raw: string) => {
    const result = parseLlmOutput(raw);
    metrics?.setLastParseOutcome(result.success ? 'ok' : result.reason);
    return result;
  };

  const firstOutput = await request(false);
  const first = parse(firstOutput);
  if (first.success) {
    return first.data;
  }

  messages.push(
    // Providers reject empty messages, so an empty response gets a placeholder.
    { role: 'assistant', text: firstOutput.length > 0 ? firstOutput : '(empty response)' },
    { role: 'user', text: buildCorrectionPrompt(first.issues) },
  );
  const second = parse(await request(true));
  if (second.success) {
    return second.data;
  }
  throw new ApiError('LLM_INVALID_OUTPUT');
}

/**
 * Entry point for analyzing a whole document. Currently a single call; this is
 * where splitting into chunks and merging their results will be added.
 */
export function analyzeDocument(
  text: string,
  llm: LlmClient,
  options: Omit<AnalyzeOptions, 'part'> = {},
): Promise<LlmAnalysis> {
  return analyzeText(text, llm, options);
}
