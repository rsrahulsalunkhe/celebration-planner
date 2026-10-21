/**
 * Money is always an integer count of the currency's minor unit, never a
 * float, so sums and splits stay exact.
 */

import { CURRENCY } from './primitives.ts';

const digitsCache = new Map<string, number>();

/** Number of decimal places in the currency's minor unit (INR 2, JPY 0). */
export function minorUnitDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  digitsCache.set(currency, digits);
  return digits;
}

export function formatMoney(
  minor: number,
  currency = CURRENCY,
  locale = 'en-IN',
): string {
  const digits = minorUnitDigits(currency);
  const scale = 10 ** digits;
  // Whole amounts read cleaner without decimals; otherwise show all of them
  // so ₹123.50 never prints as ₹123.5.
  const fractionDigits = minor % scale === 0 ? 0 : digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(minor / scale);
}

/** Editable text for an amount: `500000`, or `1250.50` when there are paise. */
export function formatMoneyInput(minor: number, currency = CURRENCY): string {
  const digits = minorUnitDigits(currency);
  const scale = 10 ** digits;
  const whole = Math.floor(minor / scale);
  const fraction = minor % scale;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(digits, '0')}`;
}

/**
 * Parses user text such as `₹1,25,000.50` into minor units. Returns `null`
 * for anything ambiguous (negative values, extra decimals, stray text).
 * Works on the digit string, avoiding float rounding.
 */
export function parseMoney(text: string, currency: string): number | null {
  const digits = minorUnitDigits(currency);
  // Strip a leading currency symbol or code, but keep "-" so negatives fail the match.
  const cleaned = text.replace(/[\s,]/g, '').replace(/^[^\d.-]+/, '');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Splits `total` across `weights` using the largest-remainder method. The
 * parts always sum to exactly `total`; ties go to the earlier entry.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError('total must be a non-negative integer');
  }
  if (weights.length === 0 || weights.some((w) => !(w >= 0))) {
    throw new RangeError('weights must be a non-empty list of non-negative numbers');
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) throw new RangeError('weights must not all be zero');

  const exact = weights.map((w) => (total * w) / weightSum);
  const parts = exact.map(Math.floor);
  let leftover = total - parts.reduce((sum, p) => sum + p, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    leftover -= 1;
  }
  return parts;
}
