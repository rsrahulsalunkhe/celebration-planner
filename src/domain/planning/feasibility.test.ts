import { describe, expect, it } from 'vitest';
import { expense } from '@/test/helpers.ts';
import { computeReserve, requiredBudgetFor } from './allocation.ts';
import { assessFeasibility, type FeasibilityInput } from './feasibility.ts';
import { forecastExpenses } from './forecast.ts';
import type { ExpenseItem } from '../types.ts';

const rupees = (n: number) => n * 100;
const fixed = (id: string, amount: number, extra: Partial<ExpenseItem> = {}) =>
  expense(id, 'c', rupees(amount), extra);
const perGuest = (id: string, rate: number, extra: Partial<ExpenseItem> = {}) =>
  expense(id, 'c', 0, {
    estimate: { basis: 'per-guest', perGuestPaise: rupees(rate) },
    ...extra,
  });

function assess(
  expenses: ExpenseItem[],
  budgetRupees: number,
  guests: number,
  options: { reserveBasisPoints?: number; targets?: number[] } = {},
) {
  const forecast = forecastExpenses(expenses, guests, ['c']);
  const input: FeasibilityInput = {
    budgetPaise: rupees(budgetRupees),
    reserveBasisPoints: options.reserveBasisPoints ?? 1000,
    expenses,
    forecast,
    categories: [
      {
        id: 'c',
        name: 'Everything',
        targetPaise:
          options.targets?.[0] === undefined
            ? rupees(budgetRupees) -
              computeReserve(rupees(budgetRupees), options.reserveBasisPoints ?? 1000)
            : rupees(options.targets[0]),
      },
    ],
  };
  return { ...assessFeasibility(input), forecast };
}

describe('an affordable plan', () => {
  it('has no money conflicts and no options', () => {
    const result = assess([fixed('hall', 50_000), perGuest('food', 400)], 300_000, 100);
    expect(result.shortfallPaise).toBe(0);
    expect(result.gapPaise).toBe(0);
    expect(result.conflicts.filter((c) => c.kind !== 'category-over-target')).toEqual([]);
    expect(result.options).toEqual([]);
  });
});

describe('infeasible budgets produce explicit conflicts with numbers', () => {
  // Fixed 1,00,000 + 1,000 per guest × 200 = 3,00,000 forecast.
  const expenses = [
    fixed('hall', 100_000),
    perGuest('food', 800, { optional: false }),
    perGuest('extras', 200),
    fixed('video', 30_000, { optional: true }),
  ];

  it('reports a numerical shortfall against the whole budget', () => {
    const result = assess(expenses, 250_000, 200);
    expect(result.forecast.forecastPaise).toBe(rupees(330_000));
    expect(result.shortfallPaise).toBe(rupees(80_000));
    const conflict = result.conflicts.find((c) => c.kind === 'forecast-exceeds-budget');
    expect(conflict).toMatchObject({ severity: 'critical', amountPaise: rupees(80_000) });
    expect(conflict?.message).toContain('₹80,000');
    expect(conflict?.message).toContain(
      'Dividing the budget differently does not change this',
    );
  });

  it('offers feasible options with exact numbers', () => {
    const result = assess(expenses, 250_000, 200);
    const spendable = rupees(250_000) - computeReserve(rupees(250_000), 1000);
    expect(spendable).toBe(rupees(225_000));

    const guests = result.options.find((o) => o.kind === 'reduce-guests');
    // 1,00,000 + 30,000 fixed; 1,000 per guest: floor((2,25,000 − 1,30,000) / 1,000) = 95 guests.
    expect(guests).toMatchObject({
      guestCount: 95,
      afterGapPaise: 0,
      afterShortfallPaise: 0,
    });
    const reduced = forecastExpenses(expenses, 95);
    expect(reduced.forecastPaise).toBeLessThanOrEqual(spendable);
    expect(forecastExpenses(expenses, 96).forecastPaise).toBeGreaterThan(spendable);

    const raise = result.options.find((o) => o.kind === 'raise-budget');
    expect(raise?.budgetPaise).toBe(requiredBudgetFor(rupees(330_000), 1000));
    expect(raise?.afterShortfallPaise).toBe(0);

    const drop = result.options.find((o) => o.kind === 'drop-optional');
    expect(drop).toMatchObject({ savingsPaise: rupees(30_000), expenseIds: ['video'] });
    expect(drop?.afterShortfallPaise).toBe(rupees(50_000)); // still over, and says so
    expect(drop?.description).toContain('still leaves');

    expect(result.options.find((o) => o.kind === 'use-reserve')).toBeUndefined(); // shortfall > 0
  });

  it('says plainly when fixed costs alone exceed what is available, and offers no guest cut', () => {
    const result = assess([fixed('hall', 300_000), perGuest('food', 100)], 250_000, 50);
    const conflict = result.conflicts.find((c) => c.kind === 'forecast-exceeds-budget');
    expect(conflict?.message).toContain('Fixed costs alone');
    expect(result.options.some((o) => o.kind === 'reduce-guests')).toBe(false);
    expect(result.options.some((o) => o.kind === 'raise-budget')).toBe(true);
  });

  it('a forecast between spendable and budget is a reserve warning, with a use-reserve option', () => {
    const result = assess([fixed('hall', 240_000)], 250_000, 10);
    expect(result.shortfallPaise).toBe(0);
    expect(result.gapPaise).toBe(rupees(15_000));
    expect(
      result.conflicts.find((c) => c.kind === 'forecast-uses-reserve'),
    ).toMatchObject({
      severity: 'warning',
      amountPaise: rupees(15_000),
    });
    expect(result.options.find((o) => o.kind === 'use-reserve')?.description).toContain(
      '₹10,000 for surprises',
    );
  });
});

describe('never looks affordable merely because the budget was distributed', () => {
  it('shortfall and conflicts are identical however the targets are split', () => {
    const expenses = [fixed('hall', 400_000)];
    const lopsided = assess(expenses, 300_000, 10, { targets: [270_000] });
    const generous = assess(expenses, 300_000, 10, { targets: [999_999] });
    const tiny = assess(expenses, 300_000, 10, { targets: [1] });
    for (const result of [lopsided, generous, tiny]) {
      expect(result.shortfallPaise).toBe(rupees(100_000));
      expect(result.conflicts.some((c) => c.kind === 'forecast-exceeds-budget')).toBe(
        true,
      );
    }
  });

  it('targets that are too high are flagged separately and never hide a shortfall', () => {
    const result = assess([fixed('hall', 10_000)], 100_000, 10, { targets: [200_000] });
    expect(result.conflicts.some((c) => c.kind === 'targets-exceed-spendable')).toBe(
      true,
    );
    expect(result.shortfallPaise).toBe(0);
  });

  it('a category over its target is informational, not a pass or fail', () => {
    const result = assess([fixed('hall', 60_000)], 300_000, 10, { targets: [50_000] });
    expect(result.conflicts.find((c) => c.kind === 'category-over-target')).toMatchObject(
      {
        severity: 'info',
        amountPaise: rupees(10_000),
      },
    );
  });
});

describe('protected items are never offered as savings', () => {
  const protectedSet = [
    fixed('ramp', 40_000, { requirement: 'wheelchair-access', optional: true }),
    fixed('menu', 30_000, { requirement: 'dietary', optional: true }),
    fixed('agreed-video', 30_000, {
      optional: true,
      commitment: { basis: 'fixed', totalPaise: rupees(30_000) },
    }),
    fixed('paid-extra', 20_000, {
      optional: true,
      payments: [{ id: 'p', amountPaise: 100, date: '2026-11-01' }],
    }),
    fixed('base', 100_000),
    fixed('spare', 10_000, { optional: true }),
  ];

  it('excludes required provisions, agreed commitments and anything already paid', () => {
    const result = assess(protectedSet, 150_000, 10);
    const drop = result.options.find((o) => o.kind === 'drop-optional');
    expect(drop?.expenseIds).toEqual(['spare']);
  });

  it('offers no drop-optional option when nothing is safely removable', () => {
    const result = assess(protectedSet.slice(0, 4), 100_000, 10);
    expect(result.options.some((o) => o.kind === 'drop-optional')).toBe(false);
  });

  it('flags agreements that alone exceed the budget', () => {
    const result = assess(
      [fixed('big', 0, { commitment: { basis: 'fixed', totalPaise: rupees(400_000) } })],
      300_000,
      10,
    );
    expect(
      result.conflicts.find((c) => c.kind === 'commitments-exceed-budget'),
    ).toMatchObject({
      severity: 'critical',
      amountPaise: rupees(100_000),
    });
  });
});

describe('determinism', () => {
  it('identical input gives identical output', () => {
    const run = () =>
      assess([fixed('hall', 400_000), perGuest('food', 300)], 300_000, 120);
    expect(run()).toEqual(run());
  });
});
