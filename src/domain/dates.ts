import type { IsoDate } from './types.ts';

/**
 * Calendar-date helpers. Dates are `YYYY-MM-DD` strings and all arithmetic
 * runs in UTC, so results never shift with the viewer's time zone or DST.
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns a UTC-midnight Date, or `null` if the text is not a real calendar date. */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date : null;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function requireDate(value: IsoDate): Date {
  const date = parseIsoDate(value);
  if (!date) throw new RangeError(`Invalid ISO date: ${value}`);
  return date;
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(requireDate(value).getTime() + days * MS_PER_DAY));
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (requireDate(to).getTime() - requireDate(from).getTime()) / MS_PER_DAY,
  );
}

/** The viewer's local calendar date as an ISO string. */
export function todayIso(now: Date = new Date()): IsoDate {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear()).padStart(4, '0')}-${month}-${day}`;
}

export function formatDate(value: IsoDate, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(requireDate(value));
}
