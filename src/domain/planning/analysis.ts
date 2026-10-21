import { daysBetween, formatDate } from '../dates.ts';
import { DEFAULT_RESERVE_BASIS_POINTS } from '../primitives.ts';
import type { EventRecord, IsoDate } from '../types.ts';
import { urgencyOf } from './deadlines.ts';
import { assessFeasibility } from './feasibility.ts';
import { forecastExpenses } from './forecast.ts';
import type {
  Conflict,
  FeasibilityOption,
  Forecast,
  PlanStatus,
  Urgency,
} from './types.ts';

export interface TaskSummary {
  total: number;
  done: number;
  /** Tasks not done that are past their due date. */
  overdue: number;
  /** Tasks not done whose usual deadline has passed (they may be rescheduled). */
  behindIdeal: number;
  byUrgency: Record<Urgency, number>;
}

/**
 * A read-only assessment of an event as it is now: what it will cost, whether
 * that is affordable, what is in conflict, and how the schedule stands.
 * Computed from the record and `today`; nothing here is stored.
 */
export interface EventAnalysis {
  today: IsoDate;
  status: PlanStatus;
  daysUntilEvent: number;
  budgetPaise: number;
  reserveBasisPoints: number;
  reservePaise: number;
  spendablePaise: number;
  plannedPaise: number;
  forecast: Forecast;
  /** Forecast above the whole budget. */
  shortfallPaise: number;
  /** Forecast above budget minus reserve. */
  gapPaise: number;
  conflicts: Conflict[];
  options: FeasibilityOption[];
  tasks: TaskSummary;
}

export function analyzeEvent(record: EventRecord, today: IsoDate): EventAnalysis {
  const { profile } = record;
  const daysUntilEvent = daysBetween(today, profile.date);
  const status: PlanStatus =
    daysUntilEvent < 0 ? 'history' : daysUntilEvent === 0 ? 'event-day' : 'upcoming';
  const reserveBasisPoints = profile.reserveBasisPoints ?? DEFAULT_RESERVE_BASIS_POINTS;

  const forecast = forecastExpenses(
    record.expenses,
    profile.guestCount,
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

  const conflicts = [...feasibility.conflicts];
  if (status === 'history') {
    conflicts.push({
      id: 'conflict.event-in-history',
      kind: 'event-in-history',
      severity: 'info',
      message: `This event was on ${formatDate(profile.date)}, which has passed. It is kept as history.`,
    });
  }

  const byUrgency: Record<Urgency, number> = {
    done: 0,
    overdue: 0,
    'due-today': 0,
    'due-soon': 0,
    upcoming: 0,
  };
  for (const task of record.tasks) byUrgency[urgencyOf(task, today)] += 1;

  return {
    today,
    status,
    daysUntilEvent,
    budgetPaise: profile.budgetPaise,
    reserveBasisPoints,
    reservePaise: feasibility.reservePaise,
    spendablePaise: feasibility.spendablePaise,
    plannedPaise: record.budgetCategories.reduce((total, c) => total + c.plannedPaise, 0),
    forecast,
    shortfallPaise: feasibility.shortfallPaise,
    gapPaise: feasibility.gapPaise,
    conflicts,
    options: feasibility.options,
    tasks: {
      total: record.tasks.length,
      done: byUrgency.done,
      overdue: byUrgency.overdue,
      behindIdeal: record.tasks.filter(
        (t) =>
          t.status !== 'done' && t.idealDueDate !== undefined && t.idealDueDate < today,
      ).length,
      byUrgency,
    },
  };
}
