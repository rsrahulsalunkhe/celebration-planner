import { describe, expect, it } from 'vitest';
import { expense } from '@/test/helpers.ts';
import { formatMoney } from '../money.ts';
import type { ExpenseItem } from '../types.ts';
import {
  commitmentTotal,
  estimateTotal,
  forecastExpenses,
  perGuestTotal,
} from './forecast.ts';

const rupees = (n: number) => n * 100;
const perGuest = (id: string, rate: number, extra: Partial<ExpenseItem> = {}) =>
  expense(id, 'c', 0, {
    estimate: { basis: 'per-guest', perGuestPaise: rupees(rate) },
    ...extra,
  });
const fixed = (id: string, amount: number, extra: Partial<ExpenseItem> = {}) =>
  expense(id, 'c', rupees(amount), extra);

describe('per-guest rates', () => {
  it('INR 400 per guest is INR 48,000 for 120 guests and INR 72,000 for 180', () => {
    const rate = { basis: 'per-guest', perGuestPaise: rupees(400) } as const;
    expect(estimateTotal(rate, 120)).toBe(rupees(48_000));
    expect(estimateTotal(rate, 180)).toBe(rupees(72_000));
    expect(formatMoney(estimateTotal(rate, 120))).toBe('₹48,000');
    expect(formatMoney(estimateTotal(rate, 180))).toBe('₹72,000');
  });

  it('refuses results that are not exact integers', () => {
    expect(() => perGuestTotal(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});

describe('changing the guest count', () => {
  const items = [
    perGuest('catering', 400),
    fixed('hall', 50_000),
    fixed('agreed-photographer', 20_000, {
      commitment: { basis: 'fixed', totalPaise: rupees(18_000) },
    }),
    perGuest('agreed-per-head', 100, {
      commitment: { basis: 'per-guest', perGuestPaise: rupees(90) },
    }),
  ];

  it('changes per-guest estimates and per-guest agreements, never fixed costs or agreed fixed quotes', () => {
    const at120 = forecastExpenses(items, 120);
    const at180 = forecastExpenses(items, 180);
    const get = (f: typeof at120, id: string) =>
      f.items.find((i) => i.expenseId === id)?.forecastPaise;

    expect(get(at120, 'catering')).toBe(rupees(48_000));
    expect(get(at180, 'catering')).toBe(rupees(72_000));
    expect(get(at120, 'hall')).toBe(get(at180, 'hall')); // fixed estimate
    expect(get(at120, 'agreed-photographer')).toBe(rupees(18_000)); // agreed fixed quote
    expect(get(at180, 'agreed-photographer')).toBe(rupees(18_000));
    expect(get(at120, 'agreed-per-head')).toBe(rupees(10_800)); // agreed per-guest rate scales
    expect(get(at180, 'agreed-per-head')).toBe(rupees(16_200));
  });

  it('forecast is exactly fixed + perGuest × guests', () => {
    for (const guests of [1, 50, 120, 180, 5000]) {
      const f = forecastExpenses(items, guests);
      expect(f.forecastPaise).toBe(f.fixedPaise + f.perGuestPaise * guests);
    }
  });

  it('an agreement replaces the estimate it was made against', () => {
    const f = forecastExpenses(
      [
        fixed('x', 20_000, {
          commitment: { basis: 'fixed', totalPaise: rupees(18_000) },
        }),
      ],
      100,
    );
    expect(f.forecastPaise).toBe(rupees(18_000));
    expect(f.items[0]?.basis).toBe('commitment');
  });
});

describe('commitments, deposits and payments', () => {
  const agreed = (totalRupees: number, depositRupees?: number, paid: number[] = []) =>
    fixed('vendor', 0, {
      commitment: {
        basis: 'fixed',
        totalPaise: rupees(totalRupees),
        ...(depositRupees === undefined ? {} : { depositPaise: rupees(depositRupees) }),
      },
      payments: paid.map((amount, i) => ({
        id: `p${i}`,
        amountPaise: rupees(amount),
        date: '2026-11-01',
      })),
    });

  it('INR 10,000 committed with INR 3,000 paid leaves INR 7,000 outstanding', () => {
    const f = forecastExpenses([agreed(10_000, undefined, [3_000])], 50);
    expect(f.committedPaise).toBe(rupees(10_000));
    expect(f.paidPaise).toBe(rupees(3_000));
    expect(f.outstandingPaise).toBe(rupees(7_000));
    expect(f.items[0]?.outstandingPaise).toBe(rupees(7_000));
  });

  it('a deposit is part of the commitment, never an additional cost', () => {
    const withDeposit = forecastExpenses([agreed(10_000, 2_000)], 50);
    const without = forecastExpenses([agreed(10_000)], 50);
    expect(withDeposit.forecastPaise).toBe(rupees(10_000));
    expect(withDeposit.forecastPaise).toBe(without.forecastPaise);
    expect(withDeposit.items[0]?.depositPaise).toBe(rupees(2_000));

    // Paying the deposit reduces what is outstanding; it does not add cost.
    const depositPaid = forecastExpenses([agreed(10_000, 2_000, [2_000])], 50);
    expect(depositPaid.forecastPaise).toBe(rupees(10_000));
    expect(depositPaid.outstandingPaise).toBe(rupees(8_000));
  });

  it('never reports a negative outstanding amount and flags overpayment', () => {
    const f = forecastExpenses([agreed(1_000, undefined, [1_500])], 50);
    expect(f.outstandingPaise).toBe(0);
    expect(f.items[0]?.overpaidPaise).toBe(rupees(500));
  });

  it('commitmentTotal follows the agreement basis', () => {
    expect(commitmentTotal({ basis: 'fixed', totalPaise: 700 }, 99)).toBe(700);
    expect(commitmentTotal({ basis: 'per-guest', perGuestPaise: 7 }, 100)).toBe(700);
  });

  it('rolls up by category, including empty ones', () => {
    const f = forecastExpenses(
      [fixed('a', 10, { categoryId: 'one' }), fixed('b', 20, { categoryId: 'two' })],
      10,
      ['empty'],
    );
    expect(f.categories.map((c) => [c.categoryId, c.forecastPaise])).toEqual([
      ['empty', 0],
      ['one', rupees(10)],
      ['two', rupees(20)],
    ]);
  });
});
