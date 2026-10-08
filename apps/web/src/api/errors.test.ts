import { API_ERROR_CODES } from '@pdf-insight/shared';
import { describe, expect, it } from 'vitest';
import {
  AnalysisError,
  errorCodeFromStatus,
  getAnalysisErrorMessage,
  isRetryableError,
  type AnalysisErrorCode,
} from './errors';

const CLIENT_CODES: AnalysisErrorCode[] = [
  'NETWORK_ERROR',
  'CLIENT_TIMEOUT',
  'INVALID_RESPONSE',
  'MISSING_API_URL',
  'UNKNOWN',
];

describe('getAnalysisErrorMessage', () => {
  it.each([...API_ERROR_CODES, ...CLIENT_CODES])('has a Polish message for %s', (code) => {
    const message = getAnalysisErrorMessage(code);
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toContain(code);
  });

  it('maps specific codes to specific messages', () => {
    expect(getAnalysisErrorMessage('RATE_LIMITED')).toMatch(/limit zapytań/);
    expect(getAnalysisErrorMessage('TEXT_TOO_LONG')).toMatch(/zbyt długi/);
    expect(getAnalysisErrorMessage('NETWORK_ERROR')).toMatch(/połączenia/);
  });

  it('is used as the AnalysisError message', () => {
    const error = new AnalysisError('LLM_TIMEOUT');
    expect(error.code).toBe('LLM_TIMEOUT');
    expect(error.message).toBe(getAnalysisErrorMessage('LLM_TIMEOUT'));
  });
});

describe('isRetryableError', () => {
  it.each<AnalysisErrorCode>(['TEXT_TOO_LONG', 'INVALID_REQUEST', 'MISSING_API_URL'])(
    '%s is not retryable',
    (code) => {
      expect(isRetryableError(code)).toBe(false);
    },
  );

  it.each<AnalysisErrorCode>(['LLM_TIMEOUT', 'LLM_UNAVAILABLE', 'RATE_LIMITED', 'NETWORK_ERROR'])(
    '%s is retryable',
    (code) => {
      expect(isRetryableError(code)).toBe(true);
    },
  );
});

describe('errorCodeFromStatus', () => {
  it.each<[number, AnalysisErrorCode]>([
    [400, 'INVALID_REQUEST'],
    [413, 'TEXT_TOO_LONG'],
    [429, 'RATE_LIMITED'],
    [502, 'LLM_UNAVAILABLE'],
    [503, 'LLM_UNAVAILABLE'],
    [504, 'LLM_TIMEOUT'],
    [500, 'INTERNAL'],
    [418, 'UNKNOWN'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(errorCodeFromStatus(status)).toBe(code);
  });
});
