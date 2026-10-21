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
import { LIMITS } from './primitives.ts';

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
  committedPaise: number;
  paidPaise: number;
}

/**
 * The four money views stay separate:
 * planned (set aside), estimated (expected cost), committed (agreed), paid.
 */
export interface BudgetSummary {
  budgetPaise: number;
  plannedPaise: number;
  /** Budget minus planned allocations. Negative means over-allocated. */
  unallocatedPaise: number;
  estimatedPaise: number;
  committedPaise: number;
  paidPaise: number;
  categories: CategoryBreakdown[];
}

export function selectBudgetSummary(record: EventRecord): BudgetSummary {
  const categories = record.budgetCategories.map((category): CategoryBreakdown => {
    const items = record.expenses.filter((e) => e.categoryId === category.id);
    return {
      category,
      plannedPaise: category.plannedPaise,
      estimatedPaise: sum(items.map((e) => e.estimatePaise)),
      committedPaise: sum(items.map((e) => e.committedPaise ?? 0)),
      paidPaise: sum(items.flatMap((e) => e.payments.map((p) => p.amountPaise))),
    };
  });
  const plannedPaise = sum(categories.map((c) => c.plannedPaise));
  return {
    budgetPaise: record.profile.budgetPaise,
    plannedPaise,
    unallocatedPaise: record.profile.budgetPaise - plannedPaise,
    estimatedPaise: sum(categories.map((c) => c.estimatedPaise)),
    committedPaise: sum(categories.map((c) => c.committedPaise)),
    paidPaise: sum(categories.map((c) => c.paidPaise)),
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
