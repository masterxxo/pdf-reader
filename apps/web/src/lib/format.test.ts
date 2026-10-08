import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_TYPE_LABELS,
  formatAmount,
  formatDate,
  formatDateTime,
  formatLanguage,
} from './format';

// Intl uses narrow no-break spaces as group separators in pl-PL.
const normalizeSpaces = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('format', () => {
  it('labels every document type in Polish', () => {
    expect(DOCUMENT_TYPE_LABELS).toEqual({
      invoice: 'Faktura',
      contract: 'Umowa',
      offer: 'Oferta',
      report: 'Raport',
      other: 'Inny',
    });
  });

  it('formats amounts in pl-PL with the currency', () => {
    expect(normalizeSpaces(formatAmount(12500, 'PLN'))).toBe('12 500,00 zł');
    expect(normalizeSpaces(formatAmount(99.5, 'EUR'))).toBe('99,50 €');
  });

  it('formats ISO dates in pl-PL without a timezone shift', () => {
    expect(formatDate('2026-10-15')).toBe('15 października 2026');
    expect(formatDate('2026-01-01')).toBe('1 stycznia 2026');
  });

  it('names languages in Polish and falls back to the code', () => {
    expect(formatLanguage('pl')).toBe('polski');
    expect(formatLanguage('en')).toBe('angielski');
    expect(formatLanguage('qq')).toBe('qq');
  });

  it('formats timestamps in pl-PL in the local time zone', () => {
    const localTime = new Date(2026, 9, 8, 14, 30).toISOString();
    expect(normalizeSpaces(formatDateTime(localTime))).toBe('8 paź 2026, 14:30');
    expect(formatDateTime('wczoraj')).toBe('wczoraj');
  });
});
