import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, minorUnitDigits, parseMoney } from './money.ts';

describe('minorUnitDigits', () => {
  it('knows common currencies', () => {
    expect(minorUnitDigits('INR')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
  });
});

describe('formatMoney', () => {
  it('formats minor units with Indian digit grouping', () => {
    expect(formatMoney(150_000_000, 'INR')).toBe('₹15,00,000');
    expect(formatMoney(12_350, 'INR')).toBe('₹123.50');
  });

  it('handles zero-decimal currencies', () => {
    expect(formatMoney(5000, 'JPY', 'en-US')).toBe('¥5,000');
  });
});

describe('parseMoney', () => {
  it('parses plain and decorated input into minor units', () => {
    expect(parseMoney('1500', 'INR')).toBe(150_000);
    expect(parseMoney('₹1,25,000.50', 'INR')).toBe(12_500_050);
    expect(parseMoney('$ 10.5', 'USD')).toBe(1050);
    expect(parseMoney('500', 'JPY')).toBe(500);
  });

  it('avoids float rounding errors', () => {
    expect(parseMoney('0.29', 'USD')).toBe(29);
    expect(parseMoney('1.15', 'USD')).toBe(115);
  });

  it('rejects ambiguous or invalid input', () => {
    expect(parseMoney('', 'INR')).toBeNull();
    expect(parseMoney('-5', 'INR')).toBeNull();
    expect(parseMoney('abc', 'INR')).toBeNull();
    expect(parseMoney('1.234', 'INR')).toBeNull();
    expect(parseMoney('10.5', 'JPY')).toBeNull();
    expect(parseMoney('1e6', 'INR')).toBeNull();
  });
});

describe('allocate', () => {
  it('splits exactly, with no lost or invented units', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 2, 3, 4]).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('respects weights and zero weights', () => {
    expect(allocate(1000, [50, 30, 20])).toEqual([500, 300, 200]);
    expect(allocate(9, [0, 1])).toEqual([0, 9]);
  });

  it('rejects invalid input', () => {
    expect(() => allocate(1.5, [1])).toThrow(RangeError);
    expect(() => allocate(-1, [1])).toThrow(RangeError);
    expect(() => allocate(10, [])).toThrow(RangeError);
    expect(() => allocate(10, [0, 0])).toThrow(RangeError);
    expect(() => allocate(10, [1, -1])).toThrow(RangeError);
  });
});
