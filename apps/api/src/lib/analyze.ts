import {
  LIST_LIMITS,
  LlmAnalysisSchema,
  llmAnalysisJsonSchema,
  type LlmAnalysis,
} from '@pdf-insight/shared';
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

/**
 * Generous for a result within LIST_LIMITS (~1,800 tokens measured on a dense
 * 12-page Polish report); only a runaway response reaches it.
 */
export const MAX_OUTPUT_TOKENS = 3_000;

/** Limits how many validation issues are sent back to the model. */
const MAX_REPORTED_ISSUES = 20;

export type ParseResult =
  | { success: true; data: LlmAnalysis }
  | { success: false; reason: 'invalid_json' | 'invalid_schema'; issues: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateList(record: Record<string, unknown>, key: string, limit: number): void {
  const list = record[key];
  if (Array.isArray(list) && list.length > limit) {
    record[key] = list.slice(0, limit);
  }
}

/**
 * Drops list items beyond LIST_LIMITS. The model is asked for its most
 * important items first, so a slightly too long list is still a usable result
 * and does not need a slow correction round trip. Mutates `json`.
 */
export function truncateLists(json: unknown): unknown {
  if (!isRecord(json)) {
    return json;
  }
  truncateList(json, 'keyPoints', LIST_LIMITS.keyPoints);
  truncateList(json, 'amounts', LIST_LIMITS.amounts);
  truncateList(json, 'dates', LIST_LIMITS.dates);
  truncateList(json, 'keywords', LIST_LIMITS.keywords);
  if (isRecord(json['entities'])) {
    truncateList(json['entities'], 'organizations', LIST_LIMITS.organizations);
    truncateList(json['entities'], 'people', LIST_LIMITS.people);
  }
  return json;
}

/** Parses and validates raw model output against LlmAnalysisSchema. */
export function parseLlmOutput(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { success: false, reason: 'invalid_json', issues: ['The response is not valid JSON.'] };
  }

  const result = LlmAnalysisSchema.safeParse(truncateLists(json));
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
      maxOutputTokens: MAX_OUTPUT_TOKENS,
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
