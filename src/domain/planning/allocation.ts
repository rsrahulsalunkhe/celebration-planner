import { formatMoney, allocate, mulDivFloor } from '../money.ts';
import type { Priority } from '../types.ts';
import type {
  AllocationCategoryInput,
  AllocationProblem,
  AllocationResult,
  AllocationTarget,
  CategoryTemplate,
} from './types.ts';

const BASIS_POINTS = 10_000;

/** Reserve in paise, rounded down so the odd paisa stays in the spendable amount. */
export function computeReserve(budgetPaise: number, reserveBasisPoints: number): number {
  return mulDivFloor(budgetPaise, reserveBasisPoints, BASIS_POINTS);
}

/**
 * The smallest total budget whose spendable amount (budget minus reserve)
 * covers `forecastPaise`. Used to say exactly how much more budget is needed.
 */
export function requiredBudgetFor(
  forecastPaise: number,
  reserveBasisPoints: number,
): number {
  if (forecastPaise <= 0) return 0;
  return (
    mulDivFloor(forecastPaise - 1, BASIS_POINTS, BASIS_POINTS - reserveBasisPoints) + 1
  );
}

/** Relative weights as shares of 10,000 that always sum to exactly 10,000. */
export function normalizeWeights(weights: readonly number[]): number[] {
  return allocate(BASIS_POINTS, weights);
}

export interface EffectiveWeight {
  /** Integer weight used for allocation (base weight scaled by the boost). */
  weight: number;
  boostPercent: number;
  matchedPriorities: Priority[];
}

/**
 * User priorities raise a category's weight by a fixed percentage per match,
 * up to a cap. Integer arithmetic only, so results are exact and repeatable.
 */
export function effectiveWeight(
  category: Pick<CategoryTemplate, 'weight' | 'priorities'>,
  userPriorities: readonly Priority[],
  boostPercentPerMatch: number,
  maxBoostPercent: number,
): EffectiveWeight {
  const matchedPriorities = category.priorities.filter((p) => userPriorities.includes(p));
  const boostPercent = Math.min(
    maxBoostPercent,
    matchedPriorities.length * boostPercentPerMatch,
  );
  return {
    weight: category.weight * (100 + boostPercent),
    boostPercent,
    matchedPriorities,
  };
}

export interface AllocateTargetsInput {
  budgetPaise: number;
  reserveBasisPoints: number;
  categories: readonly AllocationCategoryInput[];
}

/**
 * Splits the spendable budget (total minus reserve) into spending targets.
 *
 * 1. The reserve is taken off the top.
 * 2. Locked targets (explicit user choices) are kept exactly.
 * 3. Floors (the cost of required provisions) are guaranteed next.
 * 4. What is left is split by normalized weight with the largest-remainder
 *    method, so targets plus reserve equal the budget to the paisa.
 *
 * Targets are goals, not costs: see `forecast.ts` for what things will cost.
 */
export function allocateTargets(input: AllocateTargetsInput): AllocationResult {
  const { budgetPaise, reserveBasisPoints, categories } = input;
  const reservePaise = computeReserve(budgetPaise, reserveBasisPoints);
  const spendablePaise = budgetPaise - reservePaise;
  const problems: AllocationProblem[] = [];

  const locked = categories.filter((c) => c.lockedPaise !== undefined);
  const unlocked = categories.filter((c) => c.lockedPaise === undefined);
  const lockedPaise = locked.reduce((total, c) => total + (c.lockedPaise ?? 0), 0);
  const floorsPaise = unlocked.reduce((total, c) => total + (c.floorPaise ?? 0), 0);

  const byId = new Map<string, AllocationTarget>();
  const put = (
    c: AllocationCategoryInput,
    target: number,
    source: AllocationTarget['source'],
    share: number,
  ) => {
    byId.set(c.id, {
      id: c.id,
      targetPaise: target,
      source,
      floorPaise: c.floorPaise ?? 0,
      weight: c.weight,
      shareBasisPoints: share,
    });
  };

  for (const c of locked) put(c, c.lockedPaise ?? 0, 'locked', 0);

  if (lockedPaise > spendablePaise) {
    problems.push({
      kind: 'locked-exceeds-spendable',
      amountPaise: lockedPaise - spendablePaise,
      message: `Your fixed targets total ${formatMoney(lockedPaise)}, which is ${formatMoney(lockedPaise - spendablePaise)} more than the ${formatMoney(spendablePaise)} available after the reserve.`,
    });
    for (const c of unlocked) put(c, c.floorPaise ?? 0, 'weighted', 0);
  } else if (lockedPaise + floorsPaise > spendablePaise) {
    problems.push({
      kind: 'floors-exceed-spendable',
      amountPaise: lockedPaise + floorsPaise - spendablePaise,
      message: `Required provisions (${formatMoney(floorsPaise)}) plus fixed targets (${formatMoney(lockedPaise)}) are ${formatMoney(lockedPaise + floorsPaise - spendablePaise)} more than the ${formatMoney(spendablePaise)} available after the reserve.`,
    });
    for (const c of unlocked) put(c, c.floorPaise ?? 0, 'weighted', 0);
  } else {
    const pool = spendablePaise - lockedPaise - floorsPaise;
    if (unlocked.length === 0) {
      if (pool > 0) {
        problems.push({
          kind: 'nothing-to-receive-remainder',
          amountPaise: pool,
          message: `${formatMoney(pool)} is not assigned to any category.`,
        });
      }
    } else {
      const weights = unlocked.map((c) => c.weight);
      if (weights.some((w) => w <= 0))
        throw new RangeError('Category weights must be positive');
      const shares = allocate(pool, weights);
      const normalized = normalizeWeights(weights);
      unlocked.forEach((c, i) => {
        put(c, (c.floorPaise ?? 0) + (shares[i] ?? 0), 'weighted', normalized[i] ?? 0);
      });
    }
  }

  const targets = categories
    .map((c) => byId.get(c.id))
    .filter((t): t is AllocationTarget => !!t);
  const assigned = targets.reduce((total, t) => total + t.targetPaise, 0);
  const unallocatedPaise = Math.max(0, spendablePaise - assigned);

  return {
    budgetPaise,
    reserveBasisPoints,
    reservePaise,
    spendablePaise,
    targets,
    lockedPaise,
    unallocatedPaise,
    balanced: problems.length === 0 && assigned + reservePaise === budgetPaise,
    problems,
  };
}
