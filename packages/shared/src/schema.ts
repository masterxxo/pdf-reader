import { z } from 'zod';

// Note: z.object() strips unknown keys on parse (Zod's default). We rely on that
// deliberately: if the model adds extra fields, the result is still usable and
// only known fields reach the UI. Use .strict() only where rejection is wanted.

export const DocumentTypeSchema = z.enum(['invoice', 'contract', 'offer', 'report', 'other']);

/** YYYY-MM-DD that is also a real calendar date (rejects e.g. 2026-02-30). */
export const IsoDateSchema = z.iso.date();

/** ISO 639-1: two lowercase letters, e.g. "pl", "en". */
export const LanguageSchema = z.string().regex(/^[a-z]{2}$/);

/** ISO 4217: three uppercase letters, e.g. "PLN", "EUR". */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

const LlmDocumentSchema = z.object({
  language: LanguageSchema,
  type: DocumentTypeSchema,
  title: z.string().nullable(),
  date: IsoDateSchema.nullable(),
});

const AmountSchema = z.object({
  // Zod 4's z.number() already rejects NaN and ±Infinity.
  value: z.number(),
  currency: CurrencySchema,
  context: z.string(),
});

const DateEntrySchema = z.object({
  date: IsoDateSchema,
  context: z.string(),
});

/**
 * The part of the result produced by the model. document.fileName and
 * document.pages are known on the client and must never come from the model.
 */
export const LlmAnalysisSchema = z.object({
  document: LlmDocumentSchema,
  summary: z.string().trim().min(1),
  // The prompt asks for 3–7; min 1 so very short documents still validate.
  keyPoints: z.array(z.string()).min(1).max(7),
  entities: z.object({
    organizations: z.array(z.string()),
    people: z.array(z.string()),
  }),
  amounts: z.array(AmountSchema),
  dates: z.array(DateEntrySchema),
  keywords: z.array(z.string()),
});

export const AnalysisResultSchema = LlmAnalysisSchema.extend({
  document: LlmDocumentSchema.extend({
    fileName: z.string().min(1),
    pages: z.number().int().positive(),
  }),
});

export type DocumentType = z.infer<typeof DocumentTypeSchema>;
export type LlmAnalysis = z.infer<typeof LlmAnalysisSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
