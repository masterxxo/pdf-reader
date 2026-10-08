import type { DocumentType } from '@pdf-insight/shared';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Faktura',
  contract: 'Umowa',
  offer: 'Oferta',
  report: 'Raport',
  other: 'Inny',
};

const LOCALE = 'pl-PL';

const numberFormat = new Intl.NumberFormat(LOCALE);
const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long', timeZone: 'UTC' });
// Local time zone: this is when the user ran the analysis, not a document date.
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const languageNames = new Intl.DisplayNames([LOCALE], { type: 'language', fallback: 'none' });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** "pl" → "polski"; unknown codes are shown as the code itself. */
export function formatLanguage(code: string): string {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Formats an amount with its ISO 4217 currency, e.g. "12 500,00 zł". */
export function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(value);
  } catch {
    // Well-formed but unsupported currency code.
    return `${formatNumber(value)} ${currency}`;
  }
}

/** "2026-10-15" → "15 października 2026". Interpreted in UTC so it never shifts a day. */
export function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : dateFormat.format(date);
}

/** "2026-10-08T12:30:00Z" → "8 paź 2026, 14:30" (in the user's time zone). */
export function formatDateTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return Number.isNaN(date.getTime()) ? isoDateTime : dateTimeFormat.format(date);
}
