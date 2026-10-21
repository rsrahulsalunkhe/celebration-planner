import { daysBetween, formatDate } from '../dates.ts';
import { tryApplyOperations } from '../editEvent.ts';
import type {
  ChangeOperation,
  EventRecord,
  IsoDate,
  PlanningTask,
  TaskCategory,
  TaskKind,
} from '../types.ts';
import { validateConfiguration } from './configuration.ts';
import { CATCH_UP_TASKS_PER_DAY, urgencyOf } from './deadlines.ts';
import { generatePlan } from './generate.ts';
import { findCycle } from './graph.ts';
import { planOperationsFor } from './reconcile.ts';
import type { PlanningConfiguration, PlanStatus, Urgency } from './types.ts';

/**
 * The timeline as the user works with it: every task with its phase, urgency,
 * blockers and, when its usual lead time has passed, a catch-up
 * recommendation that keeps the original deadline in view.
 *
 * Everything here is derived from the saved tasks, the event date and
 * `today`; nothing is stored. Tasks are local planning records, not messages
 * or reminders: nothing here notifies anyone.
 */

export type TaskOrigin = 'generated' | 'custom';

export const PLANNING_PHASES = [
  'months-ahead',
  'one-to-two-months',
  'final-month',
  'final-week',
  'event-day',
  'follow-up',
] as const;
export type PlanningPhase = (typeof PLANNING_PHASES)[number];

export const PHASE_LABELS: Record<PlanningPhase, string> = {
  'months-ahead': 'More than two months before',
  'one-to-two-months': 'One to two months before',
  'final-month': 'The final month',
  'final-week': 'The final week',
  'event-day': 'On the event day',
  'follow-up': 'After the event',
};

export const KIND_LABELS: Record<TaskKind, string> = {
  preparation: 'Preparation',
  'event-day': 'Event day',
  'follow-up': 'Follow-up',
};

/** A task's kind, falling back to its date for older or custom tasks without one. */
export function taskKindOf(task: PlanningTask, eventDate: IsoDate): TaskKind {
  if (task.kind) return task.kind;
  if (task.dueDate < eventDate) return 'preparation';
  return task.dueDate === eventDate ? 'event-day' : 'follow-up';
}

/** Phases count back from the event using the usual deadline, so a catch-up step stays in its phase. */
export function phaseOf(task: PlanningTask, eventDate: IsoDate): PlanningPhase {
  const kind = taskKindOf(task, eventDate);
  if (kind === 'event-day') return 'event-day';
  if (kind === 'follow-up') return 'follow-up';
  const lead = daysBetween(task.idealDueDate ?? task.dueDate, eventDate);
  if (lead > 60) return 'months-ahead';
  if (lead > 30) return 'one-to-two-months';
  if (lead > 7) return 'final-month';
  return 'final-week';
}

export interface Blocker {
  id: string;
  title: string;
}

export interface CatchUp {
  /** The usual deadline, which is kept and shown. */
  originalDeadline: IsoDate;
  /** What to do now. */
  recommendation: string;
  /** Why the step is behind, in plain words. */
  problem: string;
}

export interface TimelineItem {
  task: PlanningTask;
  origin: TaskOrigin;
  kind: TaskKind;
  phase: PlanningPhase;
  urgency: Urgency;
  /** Days from today to the due date; negative when overdue. */
  daysUntilDue: number;
  /** The usual lead time has passed and the step is not done. */
  behindIdeal: boolean;
  catchUp: CatchUp | null;
  /** Prerequisites that are not done yet. Never completed automatically. */
  blockers: Blocker[];
  /** The deadline was set by hand. */
  manualDeadline: boolean;
  /** A manual deadline set for a different event date, or now after the event. */
  overrideOutdated: boolean;
  overrideProblem: string | null;
}

export interface ScheduleHealth {
  status: PlanStatus;
  daysUntilEvent: number;
  open: number;
  done: number;
  behindCount: number;
  overdueCount: number;
  /** Open preparation steps past their usual deadline. */
  catchUpCount: number;
  /** Roughly how many catch-up steps fit before the event at the catch-up pace. */
  catchUpCapacity: number;
  /** More catch-up work than days to do it: the schedule is not realistic. */
  overloaded: boolean;
  messages: string[];
}

export interface TimelineAnalysis {
  items: TimelineItem[];
  health: ScheduleHealth;
  /** Problems in the planning rules for this event type (missing or cyclic dependencies). */
  configurationErrors: string[];
  /** Problems in the saved tasks' dependencies. */
  dependencyErrors: string[];
}

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

function catchUpFor(
  task: PlanningTask,
  ideal: IsoDate,
  eventDate: IsoDate,
  today: IsoDate,
  blockers: readonly Blocker[],
): CatchUp {
  const lead = daysBetween(ideal, eventDate);
  const left = Math.max(0, daysBetween(today, eventDate));
  const due = task.dueDate;
  const when =
    due <= today
      ? 'today'
      : `by ${formatDate(due)} (${plural(daysBetween(today, due), 'day', 'days')} from now)`;
  const first =
    blockers.length > 0
      ? ` It is blocked until ${blockers.map((b) => `“${b.title}”`).join(' and ')} ${blockers.length === 1 ? 'is' : 'are'} done.`
      : '';
  return {
    originalDeadline: ideal,
    recommendation: `Catch up now: ${task.importance === 'critical' ? 'this step is critical, so ' : ''}aim to finish it ${when}.${first}`,
    problem: `This step usually needs ${plural(lead, 'day', 'days')} before the event, so it was due ${formatDate(ideal)}. Only ${plural(left, 'day is', 'days are')} left. A later date does not give back the lost lead time: expect fewer choices, rushed suppliers or higher prices.`,
  };
}

/**
 * Builds the timeline for an event. Works for upcoming, same-day and past
 * events: nothing here schedules or rewrites tasks.
 */
export function buildTimeline(
  record: EventRecord,
  today: IsoDate,
  configuration: PlanningConfiguration,
): TimelineAnalysis {
  const eventDate = record.profile.date;
  const daysUntilEvent = daysBetween(today, eventDate);
  const status: PlanStatus =
    daysUntilEvent < 0 ? 'history' : daysUntilEvent === 0 ? 'event-day' : 'upcoming';
  const byId = new Map(record.tasks.map((t) => [t.id, t]));

  const dependencyErrors: string[] = [];
  for (const task of record.tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (!byId.has(dep)) {
        dependencyErrors.push(
          `“${task.title}” depends on a task that does not exist (${dep}).`,
        );
      }
    }
  }
  const cycle = findCycle(
    record.tasks.map((t) => ({ id: t.id, dependsOn: t.dependsOn ?? [] })),
  );
  if (cycle) {
    dependencyErrors.push(
      `These tasks depend on each other in a loop, so none can be finished first: ${cycle
        .map((id) => byId.get(id)?.title ?? id)
        .join(' → ')}.`,
    );
  }
  const configurationErrors = validateConfiguration(configuration).filter(
    (p) => p.startsWith(`${record.profile.eventType}:`) || !p.includes(':'),
  );

  const items = record.tasks.map((task): TimelineItem => {
    const kind = taskKindOf(task, eventDate);
    const done = task.status === 'done';
    const blockers = (task.dependsOn ?? []).flatMap((dep) => {
      const prerequisite = byId.get(dep);
      return prerequisite && prerequisite.status !== 'done'
        ? [{ id: prerequisite.id, title: prerequisite.title }]
        : [];
    });
    const ideal = task.idealDueDate;
    const behindIdeal =
      !done &&
      kind === 'preparation' &&
      ideal !== undefined &&
      ideal < today &&
      status !== 'history';
    const manualDeadline = task.dueDateOrigin === 'user';

    let overrideProblem: string | null = null;
    if (manualDeadline && !done) {
      if (task.dueDateSetFor !== undefined && task.dueDateSetFor !== eventDate) {
        overrideProblem = `You set this deadline when the event was on ${formatDate(task.dueDateSetFor)}. The event is now on ${formatDate(eventDate)}, so check that ${formatDate(task.dueDate)} still makes sense.`;
      } else if (kind === 'preparation' && task.dueDate > eventDate) {
        overrideProblem = `This preparation step is due ${formatDate(task.dueDate)}, after the event on ${formatDate(eventDate)}.`;
      }
    }

    return {
      task,
      origin: task.templateId === undefined ? 'custom' : 'generated',
      kind,
      phase: phaseOf(task, eventDate),
      urgency: urgencyOf(task, today),
      daysUntilDue: daysBetween(today, task.dueDate),
      behindIdeal,
      catchUp:
        behindIdeal && ideal !== undefined
          ? catchUpFor(task, ideal, eventDate, today, blockers)
          : null,
      blockers,
      manualDeadline,
      overrideOutdated: overrideProblem !== null,
      overrideProblem,
    };
  });

  const open = items.filter((i) => i.task.status !== 'done');
  const catchUpCount = items.filter((i) => i.behindIdeal).length;
  const overdueCount = items.filter((i) => i.urgency === 'overdue').length;
  // Catch-up work can be done from today up to the day before the event.
  const workDays = Math.max(0, daysUntilEvent);
  const catchUpCapacity = workDays * CATCH_UP_TASKS_PER_DAY;
  const overloaded = status === 'upcoming' && catchUpCount > catchUpCapacity;

  const messages: string[] = [];
  if (status === 'history') {
    messages.push(
      `This event was on ${formatDate(eventDate)}. Its tasks are kept as history: you can still mark them done, add notes and finish follow-ups. Deadlines are no longer recalculated.`,
    );
  } else if (status === 'event-day') {
    const prep = open.filter((i) => i.kind === 'preparation').length;
    messages.push(
      `The event is today.${prep > 0 ? ` ${plural(prep, 'preparation step is', 'preparation steps are')} still open; do only what still matters today.` : ''}`,
    );
  }
  if (catchUpCount > 0) {
    messages.push(
      `${plural(catchUpCount, 'preparation step is', 'preparation steps are')} past ${catchUpCount === 1 ? 'its' : 'their'} usual deadline with ${plural(daysUntilEvent, 'day', 'days')} to go. The usual deadlines are kept for reference and catch-up dates are suggested from today, never after the event.`,
    );
  }
  if (overloaded) {
    messages.push(
      `That is more catch-up work than fits: at about ${CATCH_UP_TASKS_PER_DAY} steps a day there is room for ${catchUpCapacity} before the event. Moving every deadline to today would not make this schedule feasible. Get help, drop or combine steps, or consider a later date.`,
    );
  }
  if (overdueCount > 0 && status !== 'history') {
    messages.push(`${plural(overdueCount, 'task is', 'tasks are')} overdue.`);
  }
  if (messages.length === 0 && record.tasks.length > 0) {
    messages.push(
      `Every open step is on its usual schedule with ${plural(daysUntilEvent, 'day', 'days')} to go.`,
    );
  }

  return {
    items,
    health: {
      status,
      daysUntilEvent,
      open: open.length,
      done: items.length - open.length,
      behindCount: catchUpCount,
      overdueCount,
      catchUpCount,
      catchUpCapacity,
      overloaded,
      messages,
    },
    configurationErrors,
    dependencyErrors,
  };
}

// ---------------------------------------------------------------------------
// Grouping and filtering
// ---------------------------------------------------------------------------

export type StatusFilter = 'all' | 'open' | PlanningTask['status'];
export type UrgencyFilter = 'all' | 'behind' | 'blocked' | Urgency;

export interface TimelineFilters {
  status: StatusFilter;
  category: 'all' | 'none' | TaskCategory;
  urgency: UrgencyFilter;
  /** `all`, `unassigned`, or an owner label. */
  owner: string;
}

export const NO_FILTERS: TimelineFilters = {
  status: 'all',
  category: 'all',
  urgency: 'all',
  owner: 'all',
};

export function filterTimeline(
  items: readonly TimelineItem[],
  filters: TimelineFilters,
): TimelineItem[] {
  return items.filter((item) => {
    const { task } = item;
    if (filters.status === 'open' && task.status === 'done') return false;
    if (
      filters.status !== 'all' &&
      filters.status !== 'open' &&
      task.status !== filters.status
    )
      return false;
    if (filters.category === 'none' && task.category !== undefined) return false;
    if (
      filters.category !== 'all' &&
      filters.category !== 'none' &&
      task.category !== filters.category
    )
      return false;
    if (filters.urgency === 'behind' && !item.behindIdeal) return false;
    if (filters.urgency === 'blocked' && item.blockers.length === 0) return false;
    if (
      filters.urgency !== 'all' &&
      filters.urgency !== 'behind' &&
      filters.urgency !== 'blocked' &&
      item.urgency !== filters.urgency
    )
      return false;
    if (filters.owner === 'unassigned' && task.owner !== undefined) return false;
    if (
      filters.owner !== 'all' &&
      filters.owner !== 'unassigned' &&
      task.owner !== filters.owner
    )
      return false;
    return true;
  });
}

/** Owner labels in use, sorted, for the owner filter. */
export function ownersOf(tasks: readonly PlanningTask[]): string[] {
  return [...new Set(tasks.flatMap((t) => (t.owner ? [t.owner] : [])))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export interface PhaseGroup {
  phase: PlanningPhase;
  label: string;
  items: TimelineItem[];
}

/** Items grouped by planning phase in calendar order; within a phase, by due date then title. */
export function groupByPhase(items: readonly TimelineItem[]): PhaseGroup[] {
  return PLANNING_PHASES.flatMap((phase) => {
    const own = items
      .filter((i) => i.phase === phase)
      .sort(
        (a, b) =>
          a.task.dueDate.localeCompare(b.task.dueDate) ||
          a.task.title.localeCompare(b.task.title),
      );
    return own.length > 0 ? [{ phase, label: PHASE_LABELS[phase], items: own }] : [];
  });
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

const upsert = (item: PlanningTask): ChangeOperation => ({ op: 'tasks/upsert', item });

/** The generated tasks for an event that has none yet. Budget and ideas are left alone. */
export function startingTimelineOperations(
  record: EventRecord,
  configuration: PlanningConfiguration,
  today: IsoDate,
): ChangeOperation[] {
  return planOperationsFor(record, configuration, today).filter((op) =>
    op.op.startsWith('tasks/'),
  );
}

/** True once the event has generated tasks, so its timeline follows event changes. */
export function hasGeneratedTimeline(record: EventRecord): boolean {
  return record.tasks.some((t) => t.templateId !== undefined);
}

export interface RegeneratedEdit {
  operations: ChangeOperation[];
  /** Generated deadlines that moved. */
  moved: number;
  /** Manual deadlines that are now flagged for review. */
  flagged: number;
}

/**
 * Adds timeline consequences to an event edit (for example a new date):
 * generated deadlines and new or no-longer-applicable steps are recomputed;
 * completed tasks, custom tasks, notes, owners and manual deadlines are kept,
 * and manual deadlines set for another date are flagged by `buildTimeline`.
 * Past events are history and are not rewritten.
 */
export function withTimelineRegeneration(
  record: EventRecord,
  base: readonly ChangeOperation[],
  configuration: PlanningConfiguration,
  today: IsoDate,
): RegeneratedEdit {
  if (!hasGeneratedTimeline(record))
    return { operations: [...base], moved: 0, flagged: 0 };
  const applied = tryApplyOperations(record, base);
  if (!applied.ok) return { operations: [...base], moved: 0, flagged: 0 };
  const next = applied.record;
  const taskOps = startingTimelineOperations(next, configuration, today);
  const operations = [...base, ...taskOps];
  const result = tryApplyOperations(record, operations);
  if (!result.ok) return { operations: [...base], moved: 0, flagged: 0 };
  const moved = result.record.tasks.filter((t) => {
    const old = record.tasks.find((o) => o.id === t.id);
    return old !== undefined && old.dueDate !== t.dueDate;
  }).length;
  const flagged = buildTimeline(result.record, today, configuration).items.filter(
    (i) => i.overrideOutdated,
  ).length;
  return { operations, moved, flagged };
}

/** A deadline the user sets by hand: kept on regeneration, flagged if the event moves. */
export function setDeadlineOperation(
  task: PlanningTask,
  dueDate: IsoDate,
  eventDate: IsoDate,
): ChangeOperation {
  return upsert({ ...task, dueDate, dueDateOrigin: 'user', dueDateSetFor: eventDate });
}

/** Confirms an outdated manual deadline still stands for the current event date. */
export function keepDeadlineOperation(
  task: PlanningTask,
  eventDate: IsoDate,
): ChangeOperation {
  return upsert({ ...task, dueDateSetFor: eventDate });
}

/**
 * Returns a generated task to its planned deadline. `null` when the plan has
 * no date for it (a custom task, or a past event).
 */
export function plannedDeadlineOperation(
  record: EventRecord,
  task: PlanningTask,
  configuration: PlanningConfiguration,
  today: IsoDate,
): ChangeOperation | null {
  if (task.templateId === undefined || daysBetween(today, record.profile.date) < 0)
    return null;
  const planned = generatePlan(record, configuration, today).tasks.find(
    (t) => t.id === task.id,
  );
  if (!planned) return null;
  const { dueDateSetFor: _setFor, ...rest } = task;
  return upsert({ ...rest, dueDate: planned.dueDate, dueDateOrigin: 'generated' });
}

/** Sets a task's status. Prerequisites are never changed as a side effect. */
export function statusOperation(
  task: PlanningTask,
  status: PlanningTask['status'],
): ChangeOperation {
  return upsert({ ...task, status });
}
