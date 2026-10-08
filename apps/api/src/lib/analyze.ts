import { LlmAnalysisSchema, llmAnalysisJsonSchema, type LlmAnalysis } from '@pdf-insight/shared';
import { ApiError } from '../errors';
import type { ChatMessage, GenerateJson } from './gemini';
import {
  SYSTEM_INSTRUCTION,
  buildCorrectionPrompt,
  buildUserPrompt,
  type DocumentPart,
} from './prompt';

/** Limits how many validation issues are sent back to the model. */
const MAX_REPORTED_ISSUES = 20;

export type ParseResult =
  { success: true; data: LlmAnalysis } | { success: false; issues: string[] };

/** Parses and validates raw model output against LlmAnalysisSchema. */
export function parseLlmOutput(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { success: false, issues: ['The response is not valid JSON.'] };
  }

  const result = LlmAnalysisSchema.safeParse(json);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return { success: false, issues };
}

/**
 * Analyzes one piece of text (a whole document or, later, a single chunk).
 * Invalid output is retried exactly once, with the validation errors sent
 * back to the model; a second failure is an LLM_INVALID_OUTPUT error.
 */
export async function analyzeText(
  text: string,
  generate: GenerateJson,
  part?: DocumentPart,
): Promise<LlmAnalysis> {
  const messages: ChatMessage[] = [{ role: 'user', text: buildUserPrompt(text, part) }];
  const request = () =>
    generate({
      systemInstruction: SYSTEM_INSTRUCTION,
      messages,
      responseSchema: llmAnalysisJsonSchema,
    });

  const firstOutput = await request();
  const first = parseLlmOutput(firstOutput);
  if (first.success) {
    return first.data;
  }

  messages.push(
    // Gemini rejects empty parts, so an empty response gets a placeholder.
    { role: 'model', text: firstOutput.length > 0 ? firstOutput : '(empty response)' },
    { role: 'user', text: buildCorrectionPrompt(first.issues) },
  );
  const second = parseLlmOutput(await request());
  if (second.success) {
    return second.data;
  }
  throw new ApiError('LLM_INVALID_OUTPUT');
}

/**
 * Entry point for analyzing a whole document. Currently a single call; this is
 * where splitting into chunks and merging their results will be added.
 */
export function analyzeDocument(text: string, generate: GenerateJson): Promise<LlmAnalysis> {
  return analyzeText(text, generate);
}
