import { describe, expect, it } from 'vitest';
import { allocate, mulDivFloor } from '../money.ts';
import {
  allocateTargets,
  computeReserve,
  effectiveWeight,
  normalizeWeights,
  requiredBudgetFor,
} from './allocation.ts';

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe('exact integer arithmetic', () => {
  it('mulDivFloor is exact beyond 2^53', () => {
    expect(mulDivFloor(999_999_999_999, 999_999_999_999, 3)).toBe(
      Number((999_999_999_999n * 999_999_999_999n) / 3n),
    );
    expect(() => mulDivFloor(-1, 1, 1)).toThrow(RangeError);
    expect(() => mulDivFloor(1, 1, 0)).toThrow(RangeError);
  });

  it('allocate keeps every paisa and rejects fractional weights', () => {
    expect(allocate(9001, [50, 30, 20])).toEqual([4501, 2700, 1800]);
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(() => allocate(10, [0.5, 0.5])).toThrow(RangeError);
  });

  it('allocate always sums to the total, for many totals and weight sets', () => {
    const weightSets = [
      [1],
      [1, 1],
      [50, 30, 20],
      [7, 13, 29, 31, 3],
      [1, 999_999],
      [3, 0, 5],
    ];
    for (const weights of weightSets) {
      for (const total of [
        0, 1, 2, 7, 99, 100, 101, 9001, 123_456_789, 999_999_999_999,
      ]) {
        const parts = allocate(total, weights);
        expect(sum(parts)).toBe(total);
        // Never more than one paisa away from the exact share.
        const weightSum = sum(weights);
        parts.forEach((part, i) => {
          const exact = Number(
            (BigInt(total) * BigInt(weights[i] ?? 0)) / BigInt(weightSum),
          );
          expect(part - exact).toBeGreaterThanOrEqual(0);
          expect(part - exact).toBeLessThanOrEqual(1);
        });
      }
    }
  });

  it('breaks ties toward the earlier entry', () => {
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });
});

describe('reserve', () => {
  it('is a percentage of the whole budget, rounded down', () => {
    expect(computeReserve(10_001, 1000)).toBe(1000);
    expect(computeReserve(10_000, 1000)).toBe(1000);
    expect(computeReserve(10_000, 0)).toBe(0);
    expect(computeReserve(10_000, 2000)).toBe(2000);
  });
});

describe('allocateTargets', () => {
  const categories = [
    { id: 'a', weight: 50 },
    { id: 'b', weight: 30 },
    { id: 'c', weight: 20 },
  ];

  it('10,001 paise with a 1,000 reserve and weights 50:30:20 gives 4,501, 2,700 and 1,800', () => {
    const result = allocateTargets({
      budgetPaise: 10_001,
      reserveBasisPoints: 1000,
      categories,
    });
    expect(result.reservePaise).toBe(1000);
    expect(result.spendablePaise).toBe(9001);
    expect(result.targets.map((t) => t.targetPaise)).toEqual([4501, 2700, 1800]);
    expect(result.balanced).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('targets plus reserve equal the budget exactly across many budgets and reserves', () => {
    for (const budgetPaise of [1, 99, 10_001, 5_000_000, 123_456_789, 999_999_999_999]) {
      for (const reserveBasisPoints of [0, 1, 500, 1000, 3333, 5000]) {
        const result = allocateTargets({ budgetPaise, reserveBasisPoints, categories });
        expect(sum(result.targets.map((t) => t.targetPaise)) + result.reservePaise).toBe(
          budgetPaise,
        );
        expect(result.balanced).toBe(true);
      }
    }
  });

  it('keeps locked targets exactly and shares the rest, still summing to the budget', () => {
    const result = allocateTargets({
      budgetPaise: 10_001,
      reserveBasisPoints: 1000,
      categories: [
        { id: 'a', weight: 50, lockedPaise: 5000 },
        { id: 'b', weight: 30 },
        { id: 'c', weight: 20 },
      ],
    });
    const byId = Object.fromEntries(result.targets.map((t) => [t.id, t]));
    expect(byId.a).toMatchObject({ targetPaise: 5000, source: 'locked' });
    expect(sum(result.targets.map((t) => t.targetPaise)) + result.reservePaise).toBe(
      10_001,
    );
    expect(byId.b?.targetPaise).toBe(2401); // 4001 split 30:20, remainder to the earlier
    expect(byId.c?.targetPaise).toBe(1600);
    expect(result.balanced).toBe(true);
  });

  it('guarantees floors before sharing by weight', () => {
    const result = allocateTargets({
      budgetPaise: 10_000,
      reserveBasisPoints: 1000,
      categories: [
        { id: 'big', weight: 99 },
        { id: 'small', weight: 1, floorPaise: 2000 },
      ],
    });
    const small = result.targets.find((t) => t.id === 'small');
    expect(small?.targetPaise).toBeGreaterThanOrEqual(2000);
    expect(result.balanced).toBe(true);
  });

  it('reports an invalid allocation instead of pretending: locked targets over the spendable amount', () => {
    const result = allocateTargets({
      budgetPaise: 10_000,
      reserveBasisPoints: 1000,
      categories: [
        { id: 'a', weight: 1, lockedPaise: 9500 },
        { id: 'b', weight: 1 },
      ],
    });
    expect(result.balanced).toBe(false);
    expect(result.problems[0]).toMatchObject({
      kind: 'locked-exceeds-spendable',
      amountPaise: 500,
    });
  });

  it('reports floors that cannot fit', () => {
    const result = allocateTargets({
      budgetPaise: 10_000,
      reserveBasisPoints: 1000,
      categories: [{ id: 'a', weight: 1, floorPaise: 9500 }],
    });
    expect(result.balanced).toBe(false);
    expect(result.problems[0]?.kind).toBe('floors-exceed-spendable');
  });

  it('flags money with nowhere to go when every category is locked', () => {
    const result = allocateTargets({
      budgetPaise: 10_000,
      reserveBasisPoints: 1000,
      categories: [{ id: 'a', weight: 1, lockedPaise: 1000 }],
    });
    expect(result.balanced).toBe(false);
    expect(result.unallocatedPaise).toBe(8000);
  });

  it('is deterministic', () => {
    const run = () =>
      allocateTargets({ budgetPaise: 777_777, reserveBasisPoints: 1234, categories });
    expect(run()).toEqual(run());
  });
});

describe('normalizeWeights and priorities', () => {
  it('normalized shares always sum to 10,000', () => {
    expect(sum(normalizeWeights([22, 28, 10, 10, 7, 9, 5, 4]))).toBe(10_000);
    expect(normalizeWeights([1, 1])).toEqual([5000, 5000]);
  });

  it('a matching priority raises weight by a fixed percentage, capped', () => {
    const category = { weight: 20, priorities: ['food', 'guest-comfort'] as const };
    expect(effectiveWeight(category, [], 30, 60)).toMatchObject({
      weight: 2000,
      boostPercent: 0,
    });
    expect(effectiveWeight(category, ['food'], 30, 60)).toMatchObject({
      weight: 2600,
      boostPercent: 30,
    });
    expect(effectiveWeight(category, ['food', 'guest-comfort'], 30, 50)).toMatchObject({
      weight: 3000,
      boostPercent: 50,
    });
    expect(effectiveWeight(category, ['venue'], 30, 60).matchedPriorities).toEqual([]);
  });
});

describe('requiredBudgetFor', () => {
  it('is the smallest budget whose spendable amount covers the forecast', () => {
    for (const bp of [0, 500, 1000, 2500, 5000]) {
      for (const forecast of [1, 9001, 300_000, 4_390_000]) {
        const budget = requiredBudgetFor(forecast, bp);
        expect(budget - computeReserve(budget, bp)).toBeGreaterThanOrEqual(forecast);
        expect(budget - 1 - computeReserve(budget - 1, bp)).toBeLessThan(forecast);
      }
    }
    expect(requiredBudgetFor(0, 1000)).toBe(0);
  });
});
