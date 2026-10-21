import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDate, parseIsoDate, todayIso } from './dates.ts';

describe('parseIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
  });

  it('rejects impossible or malformed dates', () => {
    expect(parseIsoDate('2027-02-29')).toBeNull();
    expect(parseIsoDate('2027-13-01')).toBeNull();
    expect(parseIsoDate('2027-2-1')).toBeNull();
    expect(parseIsoDate('not a date')).toBeNull();
  });
});

describe('addDays / daysBetween', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('counts whole days in either direction', () => {
    expect(daysBetween('2027-01-01', '2027-02-13')).toBe(43);
    expect(daysBetween('2027-02-13', '2027-01-01')).toBe(-43);
    expect(daysBetween('2027-02-13', '2027-02-13')).toBe(0);
  });

  it('is unaffected by daylight-saving changes', () => {
    expect(daysBetween('2027-03-01', '2027-04-01')).toBe(31);
    expect(daysBetween('2027-10-01', '2027-11-01')).toBe(31);
  });

  it('throws on invalid input', () => {
    expect(() => addDays('2027-02-30', 1)).toThrow(RangeError);
  });
});

describe('todayIso', () => {
  it('uses the local calendar date', () => {
    expect(todayIso(new Date(2027, 0, 5, 23, 59))).toBe('2027-01-05');
  });
});

describe('formatDate', () => {
  it('formats without shifting the day', () => {
    expect(formatDate('2027-02-13', 'en-GB')).toBe('13 February 2027');
  });
});
