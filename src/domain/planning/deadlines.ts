import { addDays, daysBetween, formatDate } from '../dates.ts';
import type { IsoDate } from '../types.ts';
import { orderByDependencies } from './graph.ts';
import type {
  Importance,
  ScheduleSummary,
  TaskTemplate,
  TaskTiming,
  Urgency,
} from './types.ts';

/**
 * Deadlines work on calendar dates (`YYYY-MM-DD`) and take "today" as an
 * argument; nothing here reads the clock.
 *
 * Rules:
 * - A preparation step has an ideal deadline: its lead time before the event.
 * - The ideal deadline is never rewritten. If it has passed, the step is
 *   scheduled later (catch-up) but still on or before the event date.
 * - Critical steps that are behind are scheduled immediately, two per day
 *   starting today, in dependency order.
 * - Other steps that are behind are compressed: their lead time is scaled by
 *   the share of the planning horizon that is left.
 * - A step never falls due before the steps it depends on.
 * - A follow-up is an explicit step after the event and may be later.
 */

export const CATCH_UP_TASKS_PER_DAY = 2;
export const DUE_SOON_DAYS = 7;

export function idealDeadline(eventDate: IsoDate, timing: TaskTiming): IsoDate {
  return addDays(eventDate, timing.kind === 'before' ? -timing.days : timing.days);
}

export type ScheduleReason =
  'on-schedule' | 'catch-up-immediate' | 'compressed' | 'after-dependency' | 'follow-up';

export interface SchedulableTask {
  id: string;
  timing: TaskTiming;
  importance: Importance;
  /** Ids of other tasks in this list. */
  dependsOn: readonly string[];
}

export interface ScheduledTask {
  id: string;
  kind: 'preparation' | 'follow-up';
  idealDate: IsoDate;
  dueDate: IsoDate;
  /** The ideal deadline has passed. */
  behindIdeal: boolean;
  reason: ScheduleReason;
  explanation: string;
}

const laterOf = (a: IsoDate, b: IsoDate): IsoDate => (a >= b ? a : b);
const earlierOf = (a: IsoDate, b: IsoDate): IsoDate => (a <= b ? a : b);

export interface ScheduleInput {
  eventDate: IsoDate;
  today: IsoDate;
  /** The type's planning horizon in days; a longer lead on any step extends it. */
  horizonDays: number;
  tasks: readonly SchedulableTask[];
}

/** Schedules every task. Results are in the same order as `input.tasks`. */
export function scheduleTasks(input: ScheduleInput): ScheduledTask[] {
  const { eventDate, today, tasks } = input;
  const daysLeft = daysBetween(today, eventDate);
  if (daysLeft < 0)
    throw new RangeError('Cannot schedule tasks for an event that has passed');

  const { order, cycle } = orderByDependencies(tasks);
  if (cycle)
    throw new RangeError(`Task dependencies form a cycle: ${cycle.join(' -> ')}`);

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const horizon = Math.max(
    input.horizonDays,
    ...tasks.map((t) => (t.timing.kind === 'before' ? t.timing.days : 0)),
  );
  const scheduled = new Map<string, ScheduledTask>();
  let catchUpIndex = 0;

  for (const id of order) {
    const task = byId.get(id);
    if (!task) continue;
    const idealDate = idealDeadline(eventDate, task.timing);
    const lead = task.timing.days;
    let dueDate = idealDate;
    let reason: ScheduleReason =
      task.timing.kind === 'after' ? 'follow-up' : 'on-schedule';
    let explanation: string;

    if (task.timing.kind === 'after') {
      explanation = `A follow-up, ${lead} ${lead === 1 ? 'day' : 'days'} after the event (${formatDate(idealDate)}).`;
    } else if (idealDate >= today) {
      explanation = `Due ${formatDate(idealDate)}: ${lead} ${lead === 1 ? 'day' : 'days'} before the event, the usual lead time for this step.`;
    } else if (task.importance === 'critical') {
      const offset = Math.min(
        daysLeft,
        Math.floor(catchUpIndex / CATCH_UP_TASKS_PER_DAY),
      );
      catchUpIndex += 1;
      dueDate = addDays(today, offset);
      reason = 'catch-up-immediate';
      explanation = `The usual deadline (${formatDate(idealDate)}, ${lead} days before the event) has passed. This step is critical, so it is scheduled as immediate catch-up work for ${formatDate(dueDate)}.`;
    } else {
      const compressedLead = Math.round((lead * daysLeft) / horizon);
      dueDate = laterOf(today, addDays(eventDate, -compressedLead));
      reason = 'compressed';
      explanation = `The usual deadline (${formatDate(idealDate)}, ${lead} days before the event) has passed. With ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left, its lead time is compressed in proportion, to ${formatDate(dueDate)}.`;
    }

    // Never due before a dependency.
    for (const dep of task.dependsOn) {
      const depDue = scheduled.get(dep)?.dueDate;
      if (depDue !== undefined && depDue > dueDate) {
        dueDate = depDue;
        reason = 'after-dependency';
        explanation += ` Moved to ${formatDate(dueDate)} so it does not fall before a step it depends on.`;
      }
    }
    if (task.timing.kind === 'before') dueDate = earlierOf(dueDate, eventDate);

    scheduled.set(id, {
      id,
      kind: task.timing.kind === 'before' ? 'preparation' : 'follow-up',
      idealDate,
      dueDate,
      behindIdeal: task.timing.kind === 'before' && idealDate < today,
      reason,
      explanation,
    });
  }

  return tasks.flatMap((t) => {
    const s = scheduled.get(t.id);
    return s ? [s] : [];
  });
}

export function summarizeSchedule(
  scheduled: readonly ScheduledTask[],
  daysUntilEvent: number,
): ScheduleSummary {
  const behindCount = scheduled.filter((s) => s.behindIdeal).length;
  const compressed = behindCount > 0;
  const days = `${daysUntilEvent} ${daysUntilEvent === 1 ? 'day' : 'days'}`;
  const explanation = compressed
    ? `${behindCount} of ${scheduled.length} steps are past their usual deadline with ${days} to go. Their usual deadlines are kept for reference; the plan schedules catch-up work from today, never after the event.`
    : `All ${scheduled.length} steps are on their usual schedule with ${days} to go.`;
  return { daysUntilEvent, behindCount, compressed, explanation };
}

/** How pressing a task is, derived from its due date and today. Never stored. */
export function urgencyOf(
  task: { dueDate: IsoDate; status: 'todo' | 'in-progress' | 'done' },
  today: IsoDate,
): Urgency {
  if (task.status === 'done') return 'done';
  const days = daysBetween(today, task.dueDate);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due-today';
  return days <= DUE_SOON_DAYS ? 'due-soon' : 'upcoming';
}

/** Checks a set of task templates. Returns human-readable problems; empty means valid. */
export function validateTaskTemplates(templates: readonly TaskTemplate[]): string[] {
  const problems: string[] = [];
  const byId = new Map<string, TaskTemplate>();
  for (const t of templates) {
    if (byId.has(t.id)) problems.push(`Duplicate task template id: ${t.id}`);
    byId.set(t.id, t);
    if (!Number.isInteger(t.timing.days) || t.timing.days < 0) {
      problems.push(`Task ${t.id} has an invalid number of days`);
    }
  }
  for (const t of templates) {
    for (const dep of t.dependsOn) {
      const target = byId.get(dep);
      if (dep === t.id) problems.push(`Task ${t.id} depends on itself`);
      else if (!target) problems.push(`Task ${t.id} depends on unknown task ${dep}`);
      else if (t.timing.kind === 'before' && target.timing.kind === 'after') {
        problems.push(`Preparation task ${t.id} cannot depend on follow-up ${dep}`);
      } else if (
        t.timing.kind === 'before' &&
        target.timing.kind === 'before' &&
        target.timing.days < t.timing.days
      ) {
        problems.push(`Task ${t.id} is due before its dependency ${dep}`);
      }
    }
  }
  const { cycle } = orderByDependencies(templates);
  if (cycle) problems.push(`Task dependencies form a cycle: ${cycle.join(' -> ')}`);
  return problems;
}
