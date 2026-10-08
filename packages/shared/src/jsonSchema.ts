import { z } from 'zod';
import { LlmAnalysisSchema } from './schema';

/** JSON Schema of the model output, for LLM structured output. */
export const llmAnalysisJsonSchema = z.toJSONSchema(LlmAnalysisSchema);
