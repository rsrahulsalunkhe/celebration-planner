import { formatDate, parseIsoDate } from '@/domain/dates.ts';
import { findCycle } from '@/domain/planning/graph.ts';
import type { Importance } from '@/domain/planning/types.ts';
import { planningTaskSchema, runOrderItemSchema } from '@/domain/schemas.ts';
import type {
  IsoDate,
  PlanningTask,
  RunOrderItem,
  TaskCategory,
  TaskKind,
} from '@/domain/types.ts';

/**
 * Task and running-order forms. Values are text, so a blank date is reported
 * as an error rather than guessed. Event-day tasks always fall on the event
 * date; preparation is due on or before it; follow-ups come after it.
 */

export interface TaskFormValues {
  title: string;
  kind: TaskKind;
  dueDate: string;
  category: TaskCategory | '';
  importance: Importance;
  owner: string;
  notes: string;
  dependsOn: string[];
}

export type TaskField = keyof TaskFormValues;
export type TaskFormErrors = Partial<Record<TaskField, string>>;
export const TASK_FIELD_ORDER: readonly TaskField[] = [
  'title',
  'kind',
  'dueDate',
  'category',
  'importance',
  'owner',
  'notes',
  'dependsOn',
];

export function valuesFromTask(
  task: PlanningTask | null,
  kind: TaskKind,
): TaskFormValues {
  return {
    title: task?.title ?? '',
    kind: task?.kind ?? kind,
    dueDate: task?.dueDate ?? '',
    category: task?.category ?? '',
    importance: task?.importance ?? 'important',
    owner: task?.owner ?? '',
    notes: task?.notes ?? '',
    dependsOn: [...(task?.dependsOn ?? [])],
  };
}

export interface TaskContext {
  existing: PlanningTask | null;
  newId: string;
  eventDate: IsoDate;
  allTasks: readonly PlanningTask[];
}

export type TaskParse =
  | { ok: true; task: PlanningTask; deadlineChanged: boolean }
  | { ok: false; errors: TaskFormErrors };

export function dateProblem(
  kind: TaskKind,
  date: string,
  eventDate: IsoDate,
): string | null {
  if (kind === 'event-day') return null;
  if (date.trim() === '') return 'Enter a deadline';
  if (!parseIsoDate(date)) return 'Enter a real calendar date';
  if (kind === 'preparation' && date > eventDate) {
    return `Preparation must be due on or before the event (${formatDate(eventDate)})`;
  }
  if (kind === 'follow-up' && date <= eventDate) {
    return `A follow-up comes after the event (${formatDate(eventDate)})`;
  }
  return null;
}

/**
 * Builds a task from the form. Generated tasks keep their title, kind and
 * template; a changed deadline becomes a manual override recorded against the
 * current event date, so it is flagged if the event later moves.
 */
export function parseTaskForm(values: TaskFormValues, context: TaskContext): TaskParse {
  const { existing, eventDate } = context;
  const generated = existing?.templateId !== undefined;
  const kind = generated ? (existing?.kind ?? values.kind) : values.kind;
  const errors: TaskFormErrors = {};

  const dueDate = kind === 'event-day' ? eventDate : values.dueDate.trim();
  const problem = dateProblem(kind, dueDate, eventDate);
  if (problem) errors.dueDate = problem;

  const owner = values.owner.trim();
  const notes = values.notes.trim();
  const deadlineChanged = existing?.dueDate !== dueDate;
  const id = existing?.id ?? context.newId;

  const others = context.allTasks.filter((t) => t.id !== id);
  const dependsOn = generated ? (existing?.dependsOn ?? []) : values.dependsOn;
  if (!generated && dependsOn.length > 0) {
    const graph = [
      ...others.map((t) => ({ id: t.id, dependsOn: t.dependsOn ?? [] })),
      { id, dependsOn },
    ];
    if (findCycle(graph)) {
      errors.dependsOn =
        'These prerequisites would make tasks wait on each other in a loop. Remove one.';
    }
  }

  const {
    owner: _owner,
    notes: _notes,
    category: _category,
    dependsOn: _deps,
    dueDateSetFor: _setFor,
    ...kept
  } = existing ?? {};
  const candidate: PlanningTask = {
    ...kept,
    id,
    title: generated && existing ? existing.title : values.title,
    dueDate,
    dueDateOrigin: existing && !deadlineChanged ? existing.dueDateOrigin : 'user',
    status: existing?.status ?? 'todo',
    kind,
    importance:
      generated && existing?.importance ? existing.importance : values.importance,
    ...(generated && existing?.category
      ? { category: existing.category }
      : values.category
        ? { category: values.category }
        : {}),
    ...(owner ? { owner } : {}),
    ...(notes ? { notes } : {}),
    ...(dependsOn.length > 0 ? { dependsOn: [...dependsOn] } : {}),
  };
  const manual = candidate.dueDateOrigin === 'user';
  if (manual) {
    candidate.dueDateSetFor = deadlineChanged
      ? eventDate
      : (existing?.dueDateSetFor ?? eventDate);
  }

  const parsed = planningTaskSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = issue.path[0];
      if (head === 'title') errors.title ??= issue.message;
      else if (head === 'owner') errors.owner ??= issue.message;
      else if (head === 'notes') errors.notes ??= issue.message;
      else if (head === 'dueDate') errors.dueDate ??= issue.message;
      else errors.title ??= issue.message;
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    task: parsed.data,
    deadlineChanged: deadlineChanged && existing !== null,
  };
}

export interface RunOrderFormValues {
  title: string;
  start: string;
  end: string;
  owner: string;
  notes: string;
}

export type RunOrderField = keyof RunOrderFormValues;
export type RunOrderErrors = Partial<Record<RunOrderField, string>>;

export function valuesFromRunOrder(item: RunOrderItem | null): RunOrderFormValues {
  return {
    title: item?.title ?? '',
    start: item?.start ?? '',
    end: item?.end ?? '',
    owner: item?.owner ?? '',
    notes: item?.notes ?? '',
  };
}

export type RunOrderParse =
  { ok: true; item: RunOrderItem } | { ok: false; errors: RunOrderErrors };

export function parseRunOrderForm(values: RunOrderFormValues, id: string): RunOrderParse {
  const errors: RunOrderErrors = {};
  if (values.start.trim() === '') errors.start = 'Enter a start time';
  if (values.end.trim() === '') errors.end = 'Enter an end time';
  const owner = values.owner.trim();
  const notes = values.notes.trim();
  const parsed = runOrderItemSchema.safeParse({
    id,
    title: values.title,
    start: values.start.trim(),
    end: values.end.trim(),
    ...(owner ? { owner } : {}),
    ...(notes ? { notes } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = issue.path[0];
      if (
        head === 'title' ||
        head === 'start' ||
        head === 'end' ||
        head === 'owner' ||
        head === 'notes'
      ) {
        errors[head] ??= issue.message;
      }
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, item: parsed.data };
}
