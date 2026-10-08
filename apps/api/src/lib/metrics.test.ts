import { describe, expect, it, vi } from 'vitest';
import { makeLlmAnalysis } from '../test/fixtures';
import { analyzeText } from './analyze';
import { ProviderChain } from './llm/chain';
import { LlmProviderError, type LlmProvider } from './llm/types';
import { RequestMetrics, createDebugLog, estimateTokens } from './metrics';

/** A clock that advances by `stepMs` on every read. */
function steppingClock(stepMs: number) {
  let time = 0;
  return () => (time += stepMs);
}

describe('RequestMetrics', () => {
  it('records attempts with their outcome, usage and parse result', async () => {
    const outputs = [
      { text: 'nie JSON', usage: { inputTokens: 900, outputTokens: 5 }, finishReason: 'stop' },
      { text: JSON.stringify(makeLlmAnalysis()), usage: { inputTokens: 950, outputTokens: 400 } },
    ];
    const mistral: LlmProvider = {
      name: 'mistral',
      generate: vi.fn(() =>
        Promise.reject(new LlmProviderError('LLM_TIMEOUT', { canFallback: true })),
      ),
    };
    const gemini: LlmProvider = {
      name: 'gemini',
      generate: vi.fn(() => Promise.resolve(outputs.shift() ?? { text: '' })),
    };
    const metrics = new RequestMetrics({ now: steppingClock(10) });
    const chain = new ProviderChain([mistral, gemini], { metrics });

    await analyzeText('Treść', chain, { metrics });

    expect(metrics.attempts.map((a) => [a.provider, a.label, a.outcome])).toEqual([
      ['mistral', 'analyze', 'timeout'],
      ['gemini', 'analyze', 'invalid_json'],
      ['gemini', 'retry', 'ok'],
    ]);
    expect(metrics.attempts[1]?.usage).toEqual({ inputTokens: 900, outputTokens: 5 });
    expect(metrics.attempts.every((a) => a.durationMs > 0)).toBe(true);
  });

  it('formats a Server-Timing header without quotes from values', () => {
    const metrics = new RequestMetrics({ now: steppingClock(5) });
    metrics.size('chars', 1200);
    metrics.recordAttempt({
      provider: 'mistral',
      label: 'analyze',
      durationMs: 4200,
      outcome: 'ok',
      usage: { inputTokens: 400, outputTokens: 800 },
      finishReason: 'st"op',
    });

    expect(metrics.toServerTiming()).toMatch(
      /^total;dur=\d+, text;desc="chars=1200", llm1;dur=4200;desc="mistral analyze ok in=400 out=800 finish=stop"$/,
    );
  });

  it('logs only when enabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    createDebugLog(false)('event', {});
    expect(debug).not.toHaveBeenCalled();
    createDebugLog(true)('event', { a: 1 });
    expect(debug).toHaveBeenCalledWith('{"event":"event","a":1}');
    debug.mockRestore();
  });

  it('estimates tokens from the text length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(27))).toBe(10);
  });
});
