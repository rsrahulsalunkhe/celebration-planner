import type { CalendarHelper } from './dates.ts';
import { daysBetween } from './dates.ts';
import type {
  BudgetCategory,
  EventProfile,
  EventRecord,
  IsoDate,
  PlanningTask,
  SavedAppState,
} from './types.ts';
import { computeReserve } from './planning/allocation.ts';
import { estimateTotal, forecastExpenses } from './planning/forecast.ts';
import { DEFAULT_RESERVE_BASIS_POINTS, LIMITS } from './primitives.ts';

/**
 * Everything here is derived from the canonical state on demand. Totals,
 * percentages and filtered lists are never stored.
 */

const sum = (values: readonly number[]): number =>
  values.reduce((total, v) => total + v, 0);

export function selectActiveEvent(state: SavedAppState): EventRecord | null {
  return state.events.find((e) => e.profile.id === state.activeEventId) ?? null;
}

export function selectCanCreateEvent(state: SavedAppState): boolean {
  return state.events.length < LIMITS.events;
}

export function selectDaysUntil(profile: EventProfile, calendar: CalendarHelper): number {
  return daysBetween(calendar.today(), profile.date);
}

export interface CategoryBreakdown {
  category: BudgetCategory;
  plannedPaise: number;
  estimatedPaise: number;
  forecastPaise: number;
  committedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
}

/**
 * The money views stay separate:
 * planned (a spending target), estimated (what items were estimated at),
 * forecast (agreed amount where there is one, else the estimate), committed
 * (agreed), paid, and outstanding (committed minus paid).
 */
export interface BudgetSummary {
  budgetPaise: number;
  reservePaise: number;
  /** Budget minus reserve. */
  spendablePaise: number;
  plannedPaise: number;
  /** Spendable minus planned targets. Negative means the targets are too high. */
  unallocatedPaise: number;
  estimatedPaise: number;
  forecastPaise: number;
  committedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  categories: CategoryBreakdown[];
}

export function selectBudgetSummary(record: EventRecord): BudgetSummary {
  const { profile } = record;
  const forecast = forecastExpenses(
    record.expenses,
    profile.guestCount,
    record.budgetCategories.map((c) => c.id),
  );
  const categories = record.budgetCategories.map((category): CategoryBreakdown => {
    const rollup = forecast.categories.find((c) => c.categoryId === category.id);
    const items = record.expenses.filter((e) => e.categoryId === category.id);
    return {
      category,
      plannedPaise: category.plannedPaise,
      estimatedPaise: sum(
        items.map((e) => estimateTotal(e.estimate, profile.guestCount)),
      ),
      forecastPaise: rollup?.forecastPaise ?? 0,
      committedPaise: rollup?.committedPaise ?? 0,
      paidPaise: rollup?.paidPaise ?? 0,
      outstandingPaise: rollup?.outstandingPaise ?? 0,
    };
  });
  const reservePaise = computeReserve(
    profile.budgetPaise,
    profile.reserveBasisPoints ?? DEFAULT_RESERVE_BASIS_POINTS,
  );
  const plannedPaise = sum(categories.map((c) => c.plannedPaise));
  return {
    budgetPaise: profile.budgetPaise,
    reservePaise,
    spendablePaise: profile.budgetPaise - reservePaise,
    plannedPaise,
    unallocatedPaise: profile.budgetPaise - reservePaise - plannedPaise,
    estimatedPaise: sum(categories.map((c) => c.estimatedPaise)),
    forecastPaise: forecast.forecastPaise,
    committedPaise: forecast.committedPaise,
    paidPaise: forecast.paidPaise,
    outstandingPaise: forecast.outstandingPaise,
    categories,
  };
}

export interface TaskProgress {
  total: number;
  done: number;
  /** Whole percent, or `null` when there are no tasks (not 0%). */
  percent: number | null;
}

export function selectTaskProgress(record: EventRecord): TaskProgress {
  const total = record.tasks.length;
  const done = record.tasks.filter((t) => t.status === 'done').length;
  return { total, done, percent: total === 0 ? null : Math.round((done * 100) / total) };
}

export function selectOverdueTasks(record: EventRecord, today: IsoDate): PlanningTask[] {
  return record.tasks.filter((t) => t.status !== 'done' && t.dueDate < today);
}

export interface GuestSummary {
  expectedGuests: number;
  recordedPeople: number;
  accepted: number;
  declined: number;
  invited: number;
}

export function selectGuestSummary(record: EventRecord): GuestSummary {
  const people = (rsvp: string) =>
    sum(record.guests.filter((g) => g.rsvp === rsvp).map((g) => g.partySize));
  return {
    expectedGuests: record.profile.guestCount,
    recordedPeople: sum(record.guests.map((g) => g.partySize)),
    accepted: people('accepted'),
    declined: people('declined'),
    invited: people('invited'),
  };
}
