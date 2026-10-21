import { formatMoney, mulDivFloor } from '../money.ts';
import type { ExpenseItem } from '../types.ts';
import { computeReserve, requiredBudgetFor } from './allocation.ts';
import type { Conflict, FeasibilityOption, Forecast } from './types.ts';

/**
 * Affordability is judged by forecast cost against the budget, never by how
 * the budget is divided into targets. Moving targets around cannot make an
 * over-budget plan affordable, so no function here looks at targets to decide
 * whether the plan is affordable; they are only compared for information.
 */

export interface FeasibilityInput {
  budgetPaise: number;
  reserveBasisPoints: number;
  expenses: readonly ExpenseItem[];
  forecast: Forecast;
  /** Spending targets, used only for category comparisons. */
  categories: readonly { id: string; name: string; targetPaise: number }[];
}

export interface Feasibility {
  reservePaise: number;
  spendablePaise: number;
  /** Forecast above the whole budget: not coverable even with the reserve. */
  shortfallPaise: number;
  /** Forecast above the spendable amount (budget minus reserve). */
  gapPaise: number;
  conflicts: Conflict[];
  options: FeasibilityOption[];
}

const pct = (basisPoints: number): string => `${(basisPoints / 100).toString()}%`;

export function assessFeasibility(input: FeasibilityInput): Feasibility {
  const { budgetPaise, reserveBasisPoints, forecast, categories } = input;
  const reservePaise = computeReserve(budgetPaise, reserveBasisPoints);
  const spendablePaise = budgetPaise - reservePaise;
  const shortfallPaise = Math.max(0, forecast.forecastPaise - budgetPaise);
  const gapPaise = Math.max(0, forecast.forecastPaise - spendablePaise);
  const conflicts: Conflict[] = [];

  if (shortfallPaise > 0) {
    const fixedAlone =
      forecast.fixedPaise > spendablePaise
        ? ` Fixed costs alone (${formatMoney(forecast.fixedPaise)}) already exceed the ${formatMoney(spendablePaise)} available after the reserve, so fewer guests cannot fix this.`
        : '';
    conflicts.push({
      id: 'conflict.forecast-exceeds-budget',
      kind: 'forecast-exceeds-budget',
      severity: 'critical',
      amountPaise: shortfallPaise,
      message: `The plan is forecast to cost ${formatMoney(forecast.forecastPaise)}, which is ${formatMoney(shortfallPaise)} more than the whole ${formatMoney(budgetPaise)} budget. Dividing the budget differently does not change this.${fixedAlone}`,
    });
  } else if (gapPaise > 0) {
    conflicts.push({
      id: 'conflict.forecast-uses-reserve',
      kind: 'forecast-uses-reserve',
      severity: 'warning',
      amountPaise: gapPaise,
      message: `The plan is forecast to cost ${formatMoney(forecast.forecastPaise)}, which uses ${formatMoney(gapPaise)} of the ${formatMoney(reservePaise)} reserve (${pct(reserveBasisPoints)} of the budget) that is meant for surprises.`,
    });
  }

  if (forecast.committedPaise > budgetPaise) {
    conflicts.push({
      id: 'conflict.commitments-exceed-budget',
      kind: 'commitments-exceed-budget',
      severity: 'critical',
      amountPaise: forecast.committedPaise - budgetPaise,
      message: `Amounts already agreed total ${formatMoney(forecast.committedPaise)}, which is ${formatMoney(forecast.committedPaise - budgetPaise)} more than the ${formatMoney(budgetPaise)} budget. Agreed amounts are protected and are not offered as cuts.`,
    });
  }

  const targetTotal = categories.reduce((total, c) => total + c.targetPaise, 0);
  if (targetTotal > spendablePaise) {
    conflicts.push({
      id: 'conflict.targets-exceed-spendable',
      kind: 'targets-exceed-spendable',
      severity: 'warning',
      amountPaise: targetTotal - spendablePaise,
      message: `Category targets add up to ${formatMoney(targetTotal)}, which is ${formatMoney(targetTotal - spendablePaise)} more than the ${formatMoney(spendablePaise)} left after the reserve.`,
    });
  }

  for (const category of categories) {
    const cost =
      forecast.categories.find((c) => c.categoryId === category.id)?.forecastPaise ?? 0;
    if (cost > category.targetPaise) {
      conflicts.push({
        id: `conflict.category-over-target.${category.id}`,
        kind: 'category-over-target',
        severity: 'info',
        amountPaise: cost - category.targetPaise,
        subjectIds: [category.id],
        message: `${category.name} is forecast at ${formatMoney(cost)} against a ${formatMoney(category.targetPaise)} target.`,
      });
    }
  }

  return {
    reservePaise,
    spendablePaise,
    shortfallPaise,
    gapPaise,
    conflicts,
    options:
      gapPaise > 0
        ? suggestOptions(input, {
            reservePaise,
            spendablePaise,
            shortfallPaise,
            gapPaise,
          })
        : [],
  };
}

interface Amounts {
  reservePaise: number;
  spendablePaise: number;
  shortfallPaise: number;
  gapPaise: number;
}

/**
 * Ways to close the gap, each with exact numbers. Required provisions
 * (accessibility, dietary), agreed commitments and anything already paid are
 * never offered as cuts.
 */
function suggestOptions(input: FeasibilityInput, amounts: Amounts): FeasibilityOption[] {
  const { budgetPaise, reserveBasisPoints, expenses, forecast } = input;
  const { reservePaise, spendablePaise, shortfallPaise, gapPaise } = amounts;
  const options: FeasibilityOption[] = [];

  if (shortfallPaise === 0) {
    options.push({
      id: 'option.use-reserve',
      kind: 'use-reserve',
      description: `Accept spending ${formatMoney(gapPaise)} of the ${formatMoney(reservePaise)} reserve, leaving ${formatMoney(reservePaise - gapPaise)} for surprises.`,
      afterShortfallPaise: 0,
      afterGapPaise: gapPaise,
    });
  }

  const byId = new Map(forecast.items.map((i) => [i.expenseId, i]));
  const trimmable = expenses
    .filter(
      (e) =>
        e.optional === true &&
        !e.requirement &&
        e.commitment === null &&
        e.payments.length === 0,
    )
    .map((e) => ({ id: e.id, name: e.name, paise: byId.get(e.id)?.forecastPaise ?? 0 }))
    .filter((e) => e.paise > 0)
    .sort((a, b) => b.paise - a.paise || a.id.localeCompare(b.id));
  if (trimmable.length > 0) {
    const chosen: typeof trimmable = [];
    let saved = 0;
    for (const item of trimmable) {
      if (saved >= gapPaise) break;
      chosen.push(item);
      saved += item.paise;
    }
    options.push({
      id: 'option.drop-optional',
      kind: 'drop-optional',
      description: `Drop optional items (${chosen.map((c) => c.name).join(', ')}) to save ${formatMoney(saved)}.${saved < gapPaise ? ` This still leaves ${formatMoney(gapPaise - saved)} over.` : ''}`,
      savingsPaise: saved,
      expenseIds: chosen.map((c) => c.id),
      afterGapPaise: Math.max(0, gapPaise - saved),
      afterShortfallPaise: Math.max(0, shortfallPaise - saved),
    });
  }

  if (forecast.perGuestPaise > 0 && forecast.fixedPaise <= spendablePaise) {
    const maxGuests = mulDivFloor(
      spendablePaise - forecast.fixedPaise,
      1,
      forecast.perGuestPaise,
    );
    if (maxGuests >= 1 && maxGuests < forecast.guestCount) {
      const saved = forecast.perGuestPaise * (forecast.guestCount - maxGuests);
      options.push({
        id: 'option.reduce-guests',
        kind: 'reduce-guests',
        description: `Reduce guests from ${forecast.guestCount} to ${maxGuests}. That saves ${formatMoney(saved)} on per-guest items (${formatMoney(forecast.perGuestPaise)} per guest); fixed costs of ${formatMoney(forecast.fixedPaise)} stay the same.`,
        guestCount: maxGuests,
        savingsPaise: saved,
        afterGapPaise: 0,
        afterShortfallPaise: 0,
      });
    }
  }

  const neededBudget = requiredBudgetFor(forecast.forecastPaise, reserveBasisPoints);
  options.push({
    id: 'option.raise-budget',
    kind: 'raise-budget',
    description: `Raise the budget from ${formatMoney(budgetPaise)} to ${formatMoney(neededBudget)} (${formatMoney(neededBudget - budgetPaise)} more) to cover the forecast and keep the ${pct(reserveBasisPoints)} reserve.`,
    budgetPaise: neededBudget,
    afterGapPaise: 0,
    afterShortfallPaise: 0,
  });

  return options;
}
