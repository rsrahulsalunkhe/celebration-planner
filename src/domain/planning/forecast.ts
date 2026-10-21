import type { ExpenseItem } from '../types.ts';
import type { CategoryForecast, ExpenseForecast, Forecast } from './types.ts';

/**
 * Forecasts are independent of budget targets: they come only from item
 * estimates and agreed amounts. A target can never make a plan look affordable.
 */

type Estimate = ExpenseItem['estimate'];
type Commitment = NonNullable<ExpenseItem['commitment']>;

const sum = (values: readonly number[]): number =>
  values.reduce((total, v) => total + v, 0);

/** `rate * guests` in paise, refusing results that are not exact integers. */
export function perGuestTotal(perGuestPaise: number, guestCount: number): number {
  const total = perGuestPaise * guestCount;
  if (!Number.isSafeInteger(total))
    throw new RangeError('Per-guest total is out of range');
  return total;
}

/** Cost at a given guest count: fixed amounts never change, per-guest rates scale. */
export function estimateTotal(estimate: Estimate, guestCount: number): number {
  return estimate.basis === 'fixed'
    ? estimate.amountPaise
    : perGuestTotal(estimate.perGuestPaise, guestCount);
}

/**
 * Agreed total at a given guest count. A fixed agreement is unchanged by the
 * guest count; a per-guest agreement scales with it. The deposit is part of
 * this amount, never added to it.
 */
export function commitmentTotal(commitment: Commitment, guestCount: number): number {
  return commitment.basis === 'fixed'
    ? commitment.totalPaise
    : perGuestTotal(commitment.perGuestPaise, guestCount);
}

export function paidTotal(expense: Pick<ExpenseItem, 'payments'>): number {
  return sum(expense.payments.map((p) => p.amountPaise));
}

/** The amount an item contributes to the forecast: the agreement if any, else the estimate. */
export function forecastExpense(
  expense: ExpenseItem,
  guestCount: number,
): ExpenseForecast {
  const committedPaise = expense.commitment
    ? commitmentTotal(expense.commitment, guestCount)
    : null;
  const paidPaise = paidTotal(expense);
  return {
    expenseId: expense.id,
    name: expense.name,
    categoryId: expense.categoryId,
    forecastPaise: committedPaise ?? estimateTotal(expense.estimate, guestCount),
    basis: committedPaise === null ? 'estimate' : 'commitment',
    committedPaise,
    depositPaise: expense.commitment?.depositPaise ?? null,
    paidPaise,
    outstandingPaise:
      committedPaise === null ? 0 : Math.max(0, committedPaise - paidPaise),
    overpaidPaise: committedPaise === null ? 0 : Math.max(0, paidPaise - committedPaise),
  };
}

export function forecastExpenses(
  expenses: readonly ExpenseItem[],
  guestCount: number,
  categoryIds: readonly string[] = [],
): Forecast {
  const items = expenses.map((e) => forecastExpense(e, guestCount));

  const ids = [...new Set([...categoryIds, ...items.map((i) => i.categoryId)])];
  const categories = ids.map((categoryId): CategoryForecast => {
    const own = items.filter((i) => i.categoryId === categoryId);
    return {
      categoryId,
      forecastPaise: sum(own.map((i) => i.forecastPaise)),
      committedPaise: sum(own.map((i) => i.committedPaise ?? 0)),
      paidPaise: sum(own.map((i) => i.paidPaise)),
      outstandingPaise: sum(own.map((i) => i.outstandingPaise)),
    };
  });

  // forecast = fixed + perGuest * guests, so guest-count questions need no re-run.
  let fixedPaise = 0;
  let perGuestPaise = 0;
  for (const expense of expenses) {
    const active = expense.commitment ?? expense.estimate;
    if (active.basis === 'fixed') {
      fixedPaise += 'totalPaise' in active ? active.totalPaise : active.amountPaise;
    } else {
      perGuestPaise += active.perGuestPaise;
    }
  }

  return {
    guestCount,
    items,
    categories,
    forecastPaise: sum(items.map((i) => i.forecastPaise)),
    committedPaise: sum(items.map((i) => i.committedPaise ?? 0)),
    uncommittedPaise: sum(
      items.filter((i) => i.committedPaise === null).map((i) => i.forecastPaise),
    ),
    paidPaise: sum(items.map((i) => i.paidPaise)),
    outstandingPaise: sum(items.map((i) => i.outstandingPaise)),
    fixedPaise,
    perGuestPaise,
  };
}
