import { z } from 'zod';

/** Machine-readable error codes returned by the API. */
export const API_ERROR_CODES = [
  'INVALID_REQUEST',
  'TEXT_TOO_LONG',
  'RATE_LIMITED',
  'LLM_TIMEOUT',
  'LLM_UNAVAILABLE',
  'LLM_INVALID_OUTPUT',
  'NOT_FOUND',
  'INTERNAL',
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);

/** Shape of every non-2xx JSON response from the API. */
export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
  }),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
