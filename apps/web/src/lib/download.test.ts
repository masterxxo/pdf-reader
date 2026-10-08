import { describe, expect, it } from 'vitest';
import { getAnalysisFileName } from './download';

describe('getAnalysisFileName', () => {
  it.each([
    ['faktura.pdf', 'faktura.analysis.json'],
    ['Umowa 2026.PDF', 'Umowa 2026.analysis.json'],
    ['raport.final.pdf', 'raport.final.analysis.json'],
    ['bez-rozszerzenia', 'bez-rozszerzenia.analysis.json'],
    ['a/b:c*?.pdf', 'a_b_c_.analysis.json'],
    ['.pdf', 'dokument.analysis.json'],
    ['   ', 'dokument.analysis.json'],
  ])('%j → %j', (input, expected) => {
    expect(getAnalysisFileName(input)).toBe(expected);
  });
});
