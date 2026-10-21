import { tryApplyOperations } from '../editEvent.ts';
import { formatMoney } from '../money.ts';
import { DEFAULT_RESERVE_BASIS_POINTS } from '../primitives.ts';
import type {
  BudgetCategory,
  ChangeOperation,
  EventProfile,
  EventRecord,
  ExpenseItem,
  IsoDate,
  Priority,
} from '../types.ts';
import { allocateTargets, effectiveWeight } from './allocation.ts';
import { assessFeasibility } from './feasibility.ts';
import {
  commitmentTotal,
  estimateTotal,
  forecastExpenses,
  paidTotal,
} from './forecast.ts';
import { planOperationsFor } from './reconcile.ts';
import type {
  AllocationProblem,
  Conflict,
  ExpenseForecast,
  FeasibilityOption,
  PlanningConfiguration,
} from './types.ts';

/**
 * The budget ledger: one read-only view of every money figure for an event,
 * and the edits that keep category targets consistent.
 *
 * Accounting model (simplified, and the same everywhere in the app):
 *
 * - An expense contributes its committed (agreed) total when there is one,
 *   otherwise its estimate. Never both.
 * - Payments are part of a commitment. They cannot exist without one and must
 *   not exceed it. Outstanding is committed minus paid.
 * - Forecast and payments are never added together: a payment only moves
 *   money from "outstanding" to "paid" inside the same commitment.
 * - The reserve is held back from the budget and is never an expense, so the
 *   whole forecast is non-reserve spending.
 * - Headroom = budget − reserve − forecast. Negative headroom means the plan
 *   already eats into the reserve, or beyond the budget.
 *
 * Category targets are spending goals, separate from the forecast. A target
 * the user set is locked (`plannedOrigin: 'user'`); only unlocked targets are
 * ever moved by a rebalance, and nothing here unlocks a target silently.
 */

const sum = (values: readonly number[]): number =>
  values.reduce((total, v) => total + v, 0);

export function reserveBasisPointsOf(
  profile: Pick<EventProfile, 'reserveBasisPoints'>,
): number {
  return profile.reserveBasisPoints ?? DEFAULT_RESERVE_BASIS_POINTS;
}

// ---------------------------------------------------------------------------
// Accounting checks
// ---------------------------------------------------------------------------

export type AccountingIssueKind =
  'payments-without-commitment' | 'paid-exceeds-commitment';

export interface AccountingIssue {
  kind: AccountingIssueKind;
  message: string;
  amountPaise: number;
}

/**
 * Problems with how an expense's payments relate to its commitment, at a
 * given guest count. Editors refuse to save an expense with any of these; the
 * ledger reports them if they appear later (for example when a per-guest
 * agreement shrinks because the guest count went down).
 */
export function accountingIssues(
  expense: Pick<ExpenseItem, 'commitment' | 'payments'>,
  guestCount: number,
): AccountingIssue[] {
  const paid = paidTotal(expense);
  if (paid === 0) return [];
  if (expense.commitment === null) {
    return [
      {
        kind: 'payments-without-commitment',
        amountPaise: paid,
        message: `${formatMoney(paid)} is recorded as paid, but nothing is agreed yet. Payments are part of an agreed amount, so enter the agreed total first.`,
      },
    ];
  }
  const committed = commitmentTotal(expense.commitment, guestCount);
  if (paid > committed) {
    return [
      {
        kind: 'paid-exceeds-commitment',
        amountPaise: paid - committed,
        message: `Payments of ${formatMoney(paid)} are ${formatMoney(paid - committed)} more than the agreed ${formatMoney(committed)}. Payments cannot exceed the agreed amount; correct the agreement or the payments.`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Weights and floors
// ---------------------------------------------------------------------------

/**
 * Planning weights for categories that come from the configuration, with the
 * event's priorities applied exactly as the plan generator applies them.
 * Categories without a configured weight are absent and are never rebalanced.
 */
export function categoryWeights(
  record: Pick<EventRecord, 'profile' | 'budgetCategories'>,
  configuration: PlanningConfiguration,
  priorities: readonly Priority[],
): Map<string, number> {
  const templates = configuration.types[record.profile.eventType].categories;
  const weights = new Map<string, number>();
  for (const category of record.budgetCategories) {
    const template = templates.find((t) => t.id === category.templateId);
    if (!template) continue;
    weights.set(
      category.id,
      effectiveWeight(
        template,
        priorities,
        configuration.priorityBoostPercent,
        configuration.maxPriorityBoostPercent,
      ).weight,
    );
  }
  return weights;
}

/** The forecast of required provisions in each category: a target is never shared below it. */
export function requiredFloors(
  expenses: readonly ExpenseItem[],
  guestCount: number,
): Map<string, number> {
  const floors = new Map<string, number>();
  for (const expense of expenses) {
    if (!expense.requirement) continue;
    const cost = expense.commitment
      ? commitmentTotal(expense.commitment, guestCount)
      : estimateTotal(expense.estimate, guestCount);
    floors.set(expense.categoryId, (floors.get(expense.categoryId) ?? 0) + cost);
  }
  return floors;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface LedgerItem extends ExpenseForecast {
  estimate: ExpenseItem['estimate'];
  /** The estimate at the current guest count, even when an agreement replaces it. */
  estimatePaise: number;
  estimateOrigin: ExpenseItem['estimateOrigin'];
  commitment: ExpenseItem['commitment'];
  requirement: ExpenseItem['requirement'];
  optional: boolean;
  generated: boolean;
  issues: AccountingIssue[];
}

export interface LedgerCategory {
  id: string;
  name: string;
  targetPaise: number;
  /** Set by the user. Rebalancing never moves it. */
  locked: boolean;
  /** Has a planning weight, so it shares in a rebalance while unlocked. */
  weighted: boolean;
  forecastPaise: number;
  committedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  /** Target minus forecast. Negative means the forecast is above the target. */
  targetLeftPaise: number;
  requiredFloorPaise: number;
  itemCount: number;
}

export type AllocationState = 'balanced' | 'unallocated' | 'over-allocated';

export interface BudgetLedger {
  guestCount: number;
  budgetPaise: number;
  reserveBasisPoints: number;
  reserveIsDefault: boolean;
  reservePaise: number;
  /** Budget minus reserve: what targets and spending may use. */
  spendablePaise: number;
  targetsPaise: number;
  lockedTargetsPaise: number;
  unlockedTargetsPaise: number;
  /** Spendable minus all targets: positive is unallocated, negative is over-allocated. */
  allocationDifferencePaise: number;
  allocationState: AllocationState;
  /** No target can move in a rebalance (all locked, or none weighted). */
  allLocked: boolean;
  /** Committed totals where agreed, otherwise estimates. Never includes payments separately. */
  forecastPaise: number;
  committedPaise: number;
  /** Forecast of items with nothing agreed yet. */
  uncommittedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  /** Paid beyond the agreed amount. Zero unless an accounting issue exists. */
  overpaidPaise: number;
  /** Budget − reserve − forecast. */
  headroomPaise: number;
  /** Forecast above the whole budget. */
  shortfallPaise: number;
  /** Forecast above the spendable amount (into the reserve or beyond). */
  gapPaise: number;
  fixedPaise: number;
  perGuestPaise: number;
  categories: LedgerCategory[];
  items: LedgerItem[];
  conflicts: Conflict[];
  options: FeasibilityOption[];
  /** True when every total adds up (see `ledgerIdentities`). */
  reconciles: boolean;
}

export function buildLedger(
  record: EventRecord,
  configuration: PlanningConfiguration,
): BudgetLedger {
  const { profile } = record;
  const guestCount = profile.guestCount;
  const reserveBasisPoints = reserveBasisPointsOf(profile);
  const forecast = forecastExpenses(
    record.expenses,
    guestCount,
    record.budgetCategories.map((c) => c.id),
  );
  const feasibility = assessFeasibility({
    budgetPaise: profile.budgetPaise,
    reserveBasisPoints,
    expenses: record.expenses,
    forecast,
    categories: record.budgetCategories.map((c) => ({
      id: c.id,
      name: c.name,
      targetPaise: c.plannedPaise,
    })),
  });
  const weights = categoryWeights(record, configuration, record.preferences.priorities);
  const floors = requiredFloors(record.expenses, guestCount);
  const { reservePaise, spendablePaise } = feasibility;

  const items = record.expenses.map((expense, index): LedgerItem => {
    const base = forecast.items[index];
    if (!base) throw new Error('forecast is missing an expense');
    return {
      ...base,
      estimate: expense.estimate,
      estimatePaise: estimateTotal(expense.estimate, guestCount),
      estimateOrigin: expense.estimateOrigin,
      commitment: expense.commitment,
      requirement: expense.requirement,
      optional: expense.optional === true,
      generated: expense.templateId !== undefined,
      issues: accountingIssues(expense, guestCount),
    };
  });

  const categories = record.budgetCategories.map((category): LedgerCategory => {
    const rollup = forecast.categories.find((c) => c.categoryId === category.id);
    const forecastPaise = rollup?.forecastPaise ?? 0;
    return {
      id: category.id,
      name: category.name,
      targetPaise: category.plannedPaise,
      locked: category.plannedOrigin === 'user',
      weighted: weights.has(category.id),
      forecastPaise,
      committedPaise: rollup?.committedPaise ?? 0,
      paidPaise: rollup?.paidPaise ?? 0,
      outstandingPaise: rollup?.outstandingPaise ?? 0,
      targetLeftPaise: category.plannedPaise - forecastPaise,
      requiredFloorPaise: floors.get(category.id) ?? 0,
      itemCount: items.filter((i) => i.categoryId === category.id).length,
    };
  });

  const targetsPaise = sum(categories.map((c) => c.targetPaise));
  const lockedTargetsPaise = sum(
    categories.filter((c) => c.locked).map((c) => c.targetPaise),
  );
  const allocationDifferencePaise = spendablePaise - targetsPaise;
  const allLocked = categories.every((c) => c.locked || !c.weighted);
  const overpaidPaise = sum(items.map((i) => i.overpaidPaise));

  const conflicts: Conflict[] = [...feasibility.conflicts];
  if (lockedTargetsPaise > spendablePaise) {
    conflicts.push({
      id: 'conflict.locked-targets-exceed-spendable',
      kind: 'locked-targets-exceed-spendable',
      severity: 'critical',
      amountPaise: lockedTargetsPaise - spendablePaise,
      message: `Locked targets total ${formatMoney(lockedTargetsPaise)}, which is ${formatMoney(lockedTargetsPaise - spendablePaise)} more than the ${formatMoney(spendablePaise)} left after the reserve. No target is unlocked automatically: lower or unlock a locked target, lower the reserve, or raise the budget.`,
    });
  }
  if (categories.length > 0 && allocationDifferencePaise > 0) {
    conflicts.push({
      id: 'conflict.targets-unallocated',
      kind: 'targets-unallocated',
      severity: allLocked ? 'warning' : 'info',
      amountPaise: allocationDifferencePaise,
      message: allLocked
        ? `${formatMoney(allocationDifferencePaise)} of the ${formatMoney(spendablePaise)} left after the reserve is not assigned to any category, and every target is locked. Raise a target or unlock one so a rebalance can use it.`
        : `${formatMoney(allocationDifferencePaise)} of the ${formatMoney(spendablePaise)} left after the reserve is not assigned to any category. Rebalance to share it among unlocked targets.`,
    });
  }
  for (const item of items) {
    for (const issue of item.issues) {
      conflicts.push({
        id: `conflict.${issue.kind}.${item.expenseId}`,
        kind: issue.kind,
        severity: 'critical',
        amountPaise: issue.amountPaise,
        subjectIds: [item.expenseId],
        message: `${item.name}: ${issue.message}`,
      });
    }
  }

  const ledger: BudgetLedger = {
    guestCount,
    budgetPaise: profile.budgetPaise,
    reserveBasisPoints,
    reserveIsDefault: profile.reserveBasisPoints === undefined,
    reservePaise,
    spendablePaise,
    targetsPaise,
    lockedTargetsPaise,
    unlockedTargetsPaise: targetsPaise - lockedTargetsPaise,
    allocationDifferencePaise,
    allocationState:
      allocationDifferencePaise === 0
        ? 'balanced'
        : allocationDifferencePaise > 0
          ? 'unallocated'
          : 'over-allocated',
    allLocked,
    forecastPaise: forecast.forecastPaise,
    committedPaise: forecast.committedPaise,
    uncommittedPaise: forecast.uncommittedPaise,
    paidPaise: forecast.paidPaise,
    outstandingPaise: forecast.outstandingPaise,
    overpaidPaise,
    headroomPaise: profile.budgetPaise - reservePaise - forecast.forecastPaise,
    shortfallPaise: feasibility.shortfallPaise,
    gapPaise: feasibility.gapPaise,
    fixedPaise: forecast.fixedPaise,
    perGuestPaise: forecast.perGuestPaise,
    categories,
    items,
    conflicts,
    options: feasibility.options,
    reconciles: false,
  };
  ledger.reconciles = ledgerIdentities(ledger).every((identity) => identity.holds);
  return ledger;
}

export interface LedgerIdentity {
  name: string;
  holds: boolean;
}

/** The sums that must always agree. Shown in tests and used for `reconciles`. */
export function ledgerIdentities(ledger: BudgetLedger): LedgerIdentity[] {
  const c = ledger.categories;
  const i = ledger.items;
  return [
    {
      name: 'budget = reserve + forecast + headroom',
      holds:
        ledger.budgetPaise ===
        ledger.reservePaise + ledger.forecastPaise + ledger.headroomPaise,
    },
    {
      name: 'spendable = targets + allocation difference',
      holds:
        ledger.spendablePaise === ledger.targetsPaise + ledger.allocationDifferencePaise,
    },
    {
      name: 'forecast = committed + uncommitted',
      holds: ledger.forecastPaise === ledger.committedPaise + ledger.uncommittedPaise,
    },
    {
      name: 'committed + overpaid = paid + outstanding',
      holds:
        ledger.committedPaise + ledger.overpaidPaise ===
        ledger.paidPaise + ledger.outstandingPaise,
    },
    {
      name: 'category forecasts add up to the forecast',
      holds: sum(c.map((x) => x.forecastPaise)) === ledger.forecastPaise,
    },
    {
      name: 'each item contributes its agreed total, else its estimate',
      holds: i.every((x) => x.forecastPaise === (x.committedPaise ?? x.estimatePaise)),
    },
    {
      name: 'forecast = fixed + per-guest × guests',
      holds:
        ledger.forecastPaise ===
        ledger.fixedPaise + ledger.perGuestPaise * ledger.guestCount,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rebalancing and target edits
// ---------------------------------------------------------------------------

export interface TargetChange {
  id: string;
  name: string;
  beforePaise: number;
  afterPaise: number;
  locked: boolean;
}

export interface RebalanceResult {
  /** Upserts for unlocked targets that move. Locked targets never appear here. */
  operations: ChangeOperation[];
  changes: TargetChange[];
  problems: AllocationProblem[];
  /** How far locked targets and required floors exceed the spendable amount. */
  excessPaise: number;
  /** Spendable money no category receives (for example when every target is locked). */
  unallocatedPaise: number;
  /** Unlocked categories with a planning weight: the ones a rebalance can move. */
  sharedCount: number;
}

/**
 * Shares what is left after the reserve and locked targets among unlocked
 * targets, by planning weight, never below a category's required provisions.
 *
 * - Locked targets are kept exactly and never unlocked.
 * - If locked targets (and floors) do not fit, unlocked targets drop to their
 *   floor (zero when there is none), never below zero, and `excessPaise`
 *   says by how much the targets are over.
 * - If nothing can move, no allocation is attempted (so no division by a zero
 *   weight) and the unassigned amount is reported instead.
 */
export function rebalanceTargets(
  record: EventRecord,
  configuration: PlanningConfiguration,
): RebalanceResult {
  const { profile } = record;
  const weights = categoryWeights(record, configuration, record.preferences.priorities);
  const floors = requiredFloors(record.expenses, profile.guestCount);
  const inputs = record.budgetCategories.map((c) => {
    const weight = weights.get(c.id);
    return c.plannedOrigin === 'user' || weight === undefined
      ? { id: c.id, weight: 1, lockedPaise: c.plannedPaise }
      : { id: c.id, weight, floorPaise: floors.get(c.id) ?? 0 };
  });
  const sharedCount = inputs.filter((c) => c.lockedPaise === undefined).length;
  if (inputs.length === 0) {
    return {
      operations: [],
      changes: [],
      problems: [],
      excessPaise: 0,
      unallocatedPaise: 0,
      sharedCount,
    };
  }

  const allocation = allocateTargets({
    budgetPaise: profile.budgetPaise,
    reserveBasisPoints: reserveBasisPointsOf(profile),
    categories: inputs,
  });
  const assigned = sum(allocation.targets.map((t) => t.targetPaise));
  const operations: ChangeOperation[] = [];
  const changes: TargetChange[] = [];
  for (const target of allocation.targets) {
    const category = record.budgetCategories.find((c) => c.id === target.id);
    if (!category || target.source === 'locked') continue;
    if (target.targetPaise === category.plannedPaise) continue;
    const floor =
      target.floorPaise > 0
        ? ` Includes ${formatMoney(target.floorPaise)} for required provisions.`
        : '';
    const item: BudgetCategory = {
      ...category,
      plannedPaise: target.targetPaise,
      rationale: `${(target.shareBasisPoints / 100).toFixed(1)}% of what is left after the reserve and locked targets, shared by planning weight.${floor}`,
    };
    operations.push({ op: 'budgetCategories/upsert', item });
    changes.push({
      id: category.id,
      name: category.name,
      beforePaise: category.plannedPaise,
      afterPaise: target.targetPaise,
      locked: false,
    });
  }
  return {
    operations,
    changes,
    problems: allocation.problems,
    excessPaise: Math.max(0, assigned - allocation.spendablePaise),
    unallocatedPaise: allocation.unallocatedPaise,
    sharedCount,
  };
}

export type BudgetEdit =
  | { ok: true; operations: ChangeOperation[]; rebalance: RebalanceResult }
  | { ok: false; issues: string[] };

/** Applies `base`, then rebalances unlocked targets for the result, as one edit. */
export function withRebalance(
  record: EventRecord,
  configuration: PlanningConfiguration,
  base: readonly ChangeOperation[],
): BudgetEdit {
  const applied = tryApplyOperations(record, base);
  if (!applied.ok) return applied;
  const rebalance = rebalanceTargets(applied.record, configuration);
  const operations = [...base, ...rebalance.operations];
  const checked = tryApplyOperations(record, operations);
  return checked.ok ? { ok: true, operations, rebalance } : checked;
}

/** Sets a category target. A manually set target becomes locked; the rest re-share. */
export function setTargetEdit(
  record: EventRecord,
  configuration: PlanningConfiguration,
  categoryId: string,
  targetPaise: number,
): BudgetEdit {
  const category = record.budgetCategories.find((c) => c.id === categoryId);
  if (!category) return { ok: false, issues: ['That category no longer exists.'] };
  return withRebalance(record, configuration, [
    {
      op: 'budgetCategories/upsert',
      item: {
        ...category,
        plannedPaise: targetPaise,
        plannedOrigin: 'user',
        rationale: `Set by you at ${formatMoney(targetPaise)}. Locked, so rebalancing keeps it.`,
      },
    },
  ]);
}

/** Explicitly unlocks a target so it shares in rebalancing again. */
export function unlockTargetEdit(
  record: EventRecord,
  configuration: PlanningConfiguration,
  categoryId: string,
): BudgetEdit {
  const category = record.budgetCategories.find((c) => c.id === categoryId);
  if (!category) return { ok: false, issues: ['That category no longer exists.'] };
  const weights = categoryWeights(record, configuration, record.preferences.priorities);
  if (!weights.has(categoryId)) {
    return {
      ok: false,
      issues: [
        `${category.name} has no planning weight, so it cannot be shared automatically. Edit its target instead.`,
      ],
    };
  }
  return withRebalance(record, configuration, [
    {
      op: 'budgetCategories/upsert',
      item: { ...category, plannedOrigin: 'generated' },
    },
  ]);
}

/** Changes the reserve and re-shares unlocked targets around it. */
export function setReserveEdit(
  record: EventRecord,
  configuration: PlanningConfiguration,
  reserveBasisPoints: number,
): BudgetEdit {
  return withRebalance(record, configuration, [
    { op: 'profile/patch', patch: { reserveBasisPoints } },
  ]);
}

/**
 * A first budget for an event that has none: categories, targets and
 * illustrative estimates from the planning configuration. Only budget
 * collections are touched; tasks and ideas are left to their own pages.
 */
export function startingBudgetOperations(
  record: EventRecord,
  configuration: PlanningConfiguration,
  today: IsoDate,
): ChangeOperation[] {
  return planOperationsFor(record, configuration, today).filter(
    (op) => op.op.startsWith('budgetCategories/') || op.op.startsWith('expenses/'),
  );
}
