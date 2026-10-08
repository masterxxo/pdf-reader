import {
  LIST_LIMITS,
  LlmAnalysisSchema,
  llmAnalysisJsonSchema,
  type ListLimits,
  type LlmAnalysis,
} from '@pdf-insight/shared';
import { z } from 'zod';
import { ApiError } from '../errors';
import type { TimeBudget } from './budget';
import { splitIntoChunks } from './chunking';
import type { ProviderChain } from './llm/chain';
import type { ChatMessage, JsonSchema } from './llm/types';
import { mergePartials } from './merge';
import type { RequestMetrics } from './metrics';
import {
  PART_FACTS_LIMIT,
  REDUCE_SYSTEM_INSTRUCTION,
  SYSTEM_INSTRUCTION,
  buildCorrectionPrompt,
  buildReducePrompt,
  buildUserPrompt,
} from './prompt';

/**
 * Generous for a result within LIST_LIMITS (~1,800 tokens measured on a dense
 * 12-page Polish report); only a runaway response reaches it.
 */
export const MAX_OUTPUT_TOKENS = 3_000;
/** The reduce step writes only the document fields, summary, key points and keywords. */
export const REDUCE_MAX_OUTPUT_TOKENS = 1_500;
/** Kept free for the reduce step while the chunks of a long document are analyzed. */
export const REDUCE_RESERVE_MS = 9_000;

/** Limits how many validation issues are sent back to the model. */
const MAX_REPORTED_ISSUES = 20;

/**
 * List limits for each of `chunkCount` chunks: an equal share of the final
 * limit. Partial outputs stay small enough for the map and reduce steps to fit
 * the time budget (with the full limits a partial was ~1,400 tokens and two
 * took 23 s), and the merged lists can still reach the full limits.
 */
export function partialLimits(chunkCount: number): ListLimits {
  const share = (limit: number) => Math.max(1, Math.ceil(limit / chunkCount));
  return {
    keyPoints: LIST_LIMITS.keyPoints,
    organizations: share(LIST_LIMITS.organizations),
    people: share(LIST_LIMITS.people),
    amounts: share(LIST_LIMITS.amounts),
    dates: share(LIST_LIMITS.dates),
    keywords: share(LIST_LIMITS.keywords),
  };
}

const { shape } = LlmAnalysisSchema;

/** Map step output: one chunk's facts instead of a summary, and lists within `limits`. */
export function partialAnalysisSchema(limits: ListLimits) {
  return z.object({
    document: shape.document,
    facts: z.array(z.string()).min(1).max(PART_FACTS_LIMIT),
    entities: z.object({
      organizations: z.array(z.string()).max(limits.organizations),
      people: z.array(z.string()).max(limits.people),
    }),
    amounts: z.array(shape.amounts.element).max(limits.amounts),
    dates: z.array(shape.dates.element).max(limits.dates),
    keywords: z.array(z.string()).max(limits.keywords),
  });
}
export type PartialAnalysis = z.infer<ReturnType<typeof partialAnalysisSchema>>;

/** Reduce step output; entities, amounts and dates are merged in code (lib/merge.ts). */
export const ReducedAnalysisSchema = LlmAnalysisSchema.pick({
  document: true,
  summary: true,
  keyPoints: true,
  keywords: true,
});
const reducedJsonSchema: JsonSchema = z.toJSONSchema(ReducedAnalysisSchema);

export type ParseResult<T = LlmAnalysis> =
  | { success: true; data: T }
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
export function truncateLists(json: unknown, limits: ListLimits = LIST_LIMITS): unknown {
  if (!isRecord(json)) {
    return json;
  }
  truncateList(json, 'keyPoints', limits.keyPoints);
  truncateList(json, 'amounts', limits.amounts);
  truncateList(json, 'dates', limits.dates);
  truncateList(json, 'keywords', limits.keywords);
  truncateList(json, 'facts', PART_FACTS_LIMIT);
  if (isRecord(json['entities'])) {
    truncateList(json['entities'], 'organizations', limits.organizations);
    truncateList(json['entities'], 'people', limits.people);
  }
  return json;
}

/** Parses and validates raw model output against `schema`. */
export function parseOutput<T>(
  raw: string,
  schema: z.ZodType<T>,
  limits: ListLimits = LIST_LIMITS,
): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { success: false, reason: 'invalid_json', issues: ['The response is not valid JSON.'] };
  }

  const result = schema.safeParse(truncateLists(json, limits));
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return { success: false, reason: 'invalid_schema', issues };
}

/** Parses and validates raw model output against LlmAnalysisSchema. */
export function parseLlmOutput(raw: string): ParseResult {
  return parseOutput(raw, LlmAnalysisSchema);
}

export type LlmClient = Pick<ProviderChain, 'generate'>;

export interface LlmCallContext {
  signal?: AbortSignal;
  metrics?: RequestMetrics;
  /** Overrides the chain's time budget. */
  budget?: TimeBudget;
  /** Re-send a call rate limited for a short time instead of falling back. */
  waitOnRateLimit?: boolean;
}

interface ValidatedCall<T> {
  systemInstruction: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  jsonSchema: JsonSchema;
  /** Name in metrics; the correction attempt is "<label>-retry". */
  label: string;
  maxOutputTokens: number;
  /** List limits the output is truncated to before validation. */
  limits?: ListLimits;
}

/**
 * One model call whose output must match `schema`. Invalid output is retried
 * exactly once, with the validation errors sent back to the model; a second
 * failure is an LLM_INVALID_OUTPUT error.
 */
async function generateValidated<T>(
  llm: LlmClient,
  call: ValidatedCall<T>,
  context: LlmCallContext,
): Promise<T> {
  const { signal, metrics, budget, waitOnRateLimit } = context;
  const messages: ChatMessage[] = [{ role: 'user', text: call.userPrompt }];
  const request = (isRetry: boolean) =>
    llm.generate({ systemInstruction: call.systemInstruction, messages }, call.jsonSchema, {
      signal,
      isRetry,
      label: isRetry ? `${call.label}-retry` : call.label,
      maxOutputTokens: call.maxOutputTokens,
      budget,
      waitOnRateLimit: isRetry || waitOnRateLimit,
    });

  const parse = (raw: string) => {
    const result = parseOutput(raw, call.schema, call.limits);
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

/** Analyzes a whole document in a single call. */
export function analyzeText(
  text: string,
  llm: LlmClient,
  context: LlmCallContext = {},
): Promise<LlmAnalysis> {
  return generateValidated(
    llm,
    {
      systemInstruction: SYSTEM_INSTRUCTION,
      userPrompt: buildUserPrompt(text),
      schema: LlmAnalysisSchema,
      jsonSchema: llmAnalysisJsonSchema,
      label: 'analyze',
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
    context,
  );
}

/**
 * Runs `fn` on every item, at most `concurrency` at a time, and returns the
 * results in item order. After the first failure no new item is started and
 * that failure is thrown.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  // Every slot is filled unless a call fails, in which case nothing is returned.
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      try {
        results[index] = await fn(item, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export interface LongDocumentConfig {
  /** Text above this many estimated tokens is analyzed in chunks of at most this size. */
  singleCallMaxTokens: number;
  /** More chunks than this cannot finish within the time budget: TEXT_TOO_LONG. */
  maxChunks: number;
  /** Chunks analyzed at the same time (provider rate limits allow only a few). */
  concurrency: number;
}

export interface AnalyzeDocumentOptions extends LlmCallContext {
  config: LongDocumentConfig;
}

/**
 * Map step: every chunk gives a compact partial result (facts and capped
 * lists). Reduce step: lists are merged in code and one call writes the
 * summary, key points, keywords and document fields for the whole document.
 */
async function analyzeInChunks(
  chunks: readonly string[],
  llm: LlmClient,
  options: AnalyzeDocumentOptions,
): Promise<LlmAnalysis> {
  const { signal, metrics, budget, config } = options;
  // Stops the other chunks as soon as one fails.
  const controller = new AbortController();
  const chunkSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const mapBudget = budget?.withReserve(REDUCE_RESERVE_MS);
  const limits = partialLimits(chunks.length);
  const schema = partialAnalysisSchema(limits);
  const jsonSchema: JsonSchema = z.toJSONSchema(schema);

  let partials: PartialAnalysis[];
  try {
    partials = await mapWithConcurrency(chunks, config.concurrency, (chunk, index) =>
      generateValidated(
        llm,
        {
          systemInstruction: SYSTEM_INSTRUCTION,
          userPrompt: buildUserPrompt(chunk, { index: index + 1, total: chunks.length, limits }),
          schema,
          jsonSchema,
          label: `map-${String(index + 1)}`,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          limits,
        },
        // Parallel calls can briefly exceed a per-second limit: wait, don't fall back.
        { signal: chunkSignal, metrics, budget: mapBudget, waitOnRateLimit: true },
      ),
    );
  } catch (error) {
    controller.abort();
    throw error;
  }

  const reduced = await generateValidated(
    llm,
    {
      systemInstruction: REDUCE_SYSTEM_INSTRUCTION,
      userPrompt: buildReducePrompt(
        partials.map(({ document, facts, keywords }) => ({ document, facts, keywords })),
      ),
      schema: ReducedAnalysisSchema,
      jsonSchema: reducedJsonSchema,
      label: 'reduce',
      maxOutputTokens: REDUCE_MAX_OUTPUT_TOKENS,
    },
    { signal, metrics, budget },
  );

  const result = LlmAnalysisSchema.safeParse({ ...reduced, ...mergePartials(partials) });
  if (!result.success) {
    throw new ApiError('LLM_INVALID_OUTPUT', { cause: result.error });
  }
  return result.data;
}

/**
 * Entry point for analyzing a whole (normalized) document: a single call when
 * it fits comfortably, otherwise map-reduce over a few large chunks. A
 * document needing more chunks than can finish in time is rejected upfront.
 */
export function analyzeDocument(
  text: string,
  llm: LlmClient,
  options: AnalyzeDocumentOptions,
): Promise<LlmAnalysis> {
  const chunks = splitIntoChunks(text, options.config.singleCallMaxTokens);
  options.metrics?.size('chunks', chunks.length);
  if (chunks.length === 1) {
    return analyzeText(text, llm, options);
  }
  if (chunks.length > options.config.maxChunks) {
    return Promise.reject(new ApiError('TEXT_TOO_LONG'));
  }
  return analyzeInChunks(chunks, llm, options);
}
