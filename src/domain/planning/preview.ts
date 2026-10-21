import { formatDate } from '../dates.ts';
import { tryApplyOperations } from '../editEvent.ts';
import { formatMoney } from '../money.ts';
import { proposedChangeSchema } from '../schemas.ts';
import type { EventRecord, IsoDate, ProposedChange, SavedAppState } from '../types.ts';
import { analyzeEvent, type EventAnalysis } from './analysis.ts';
import { urgencyOf } from './deadlines.ts';
import { forecastExpenses } from './forecast.ts';
import type { Conflict, FeasibilityOption, Urgency } from './types.ts';

export type PreviewStatus =
  /** The change is valid and can be accepted. */
  | 'ok'
  /** The event changed after the proposal was made. */
  | 'stale'
  /** The proposal or its result is not valid. */
  | 'invalid'
  /** The result would break a rule that needs an explicit decision. */
  | 'blocked';

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface ExpenseChange {
  id: string;
  name: string;
  beforePaise: number;
  afterPaise: number;
}

export interface TaskMove {
  id: string;
  title: string;
  from: IsoDate;
  to: IsoDate;
  urgencyBefore: Urgency;
  urgencyAfter: Urgency;
}

export interface ChangePreview {
  changeId: string;
  eventId: string;
  status: PreviewStatus;
  canApply: boolean;
  /** Why the change cannot be applied, in plain words. */
  reasons: string[];
  before: EventAnalysis | null;
  after: EventAnalysis | null;
  fieldChanges: FieldChange[];
  money: {
    budgetBefore: number;
    budgetAfter: number;
    reserveBefore: number;
    reserveAfter: number;
    forecastBefore: number;
    forecastAfter: number;
    shortfallBefore: number;
    shortfallAfter: number;
    gapBefore: number;
    gapAfter: number;
  };
  expenses: {
    added: ExpenseChange[];
    removed: ExpenseChange[];
    changed: ExpenseChange[];
  };
  tasks: {
    added: { id: string; title: string; dueDate: IsoDate }[];
    removed: { id: string; title: string }[];
    rescheduled: TaskMove[];
  };
  conflicts: { introduced: Conflict[]; resolved: Conflict[]; remaining: Conflict[] };
  /** Ways to close any remaining gap, computed for the result. */
  options: FeasibilityOption[];
  /** Plain-language consequences, in reading order. */
  summary: string[];
}

const emptyMoney = (): ChangePreview['money'] => ({
  budgetBefore: 0,
  budgetAfter: 0,
  reserveBefore: 0,
  reserveAfter: 0,
  forecastBefore: 0,
  forecastAfter: 0,
  shortfallBefore: 0,
  shortfallAfter: 0,
  gapBefore: 0,
  gapAfter: 0,
});

function withoutAnalysis(
  change: ProposedChange,
  status: PreviewStatus,
  reasons: string[],
  before: EventAnalysis | null = null,
): ChangePreview {
  return {
    changeId: change.id,
    eventId: change.eventId,
    status,
    canApply: false,
    reasons,
    before,
    after: null,
    fieldChanges: [],
    money: emptyMoney(),
    expenses: { added: [], removed: [], changed: [] },
    tasks: { added: [], removed: [], rescheduled: [] },
    conflicts: { introduced: [], resolved: [], remaining: before?.conflicts ?? [] },
    options: [],
    summary: reasons,
  };
}

const pct = (basisPoints: number): string => `${(basisPoints / 100).toString()}%`;

const FIELD_FORMATS: {
  field: string;
  label: string;
  read: (r: EventRecord) => string;
}[] = [
  { field: 'title', label: 'Title', read: (r) => r.profile.title },
  { field: 'eventType', label: 'Event type', read: (r) => r.profile.eventType },
  { field: 'date', label: 'Date', read: (r) => formatDate(r.profile.date) },
  { field: 'city', label: 'City', read: (r) => r.profile.city },
  { field: 'guestCount', label: 'Guests', read: (r) => String(r.profile.guestCount) },
  {
    field: 'budgetPaise',
    label: 'Budget',
    read: (r) => formatMoney(r.profile.budgetPaise),
  },
  { field: 'setting', label: 'Setting', read: (r) => r.profile.setting },
  {
    field: 'reserveBasisPoints',
    label: 'Reserve',
    read: (r) =>
      r.profile.reserveBasisPoints === undefined
        ? 'default'
        : pct(r.profile.reserveBasisPoints),
  },
  { field: 'ageBand', label: 'Age band', read: (r) => r.profile.ageBand ?? 'not set' },
  {
    field: 'priorities',
    label: 'Priorities',
    read: (r) => r.preferences.priorities.join(', ') || 'none',
  },
  {
    field: 'dietaryNeeds',
    label: 'Dietary needs',
    read: (r) => r.preferences.dietaryNeeds.join(', ') || 'none',
  },
  {
    field: 'accessibilityNeeds',
    label: 'Accessibility needs',
    read: (r) => r.preferences.accessibilityNeeds.join(', ') || 'none',
  },
  {
    field: 'culturalPreferences',
    label: 'Cultural preferences',
    read: (r) => r.preferences.culturalPreferences.join(', ') || 'none',
  },
];

const stillRequired = (record: EventRecord, requirement: string): boolean =>
  requirement === 'dietary'
    ? record.preferences.dietaryNeeds.length > 0
    : record.preferences.accessibilityNeeds.some((need) => need === requirement);

/**
 * Required provisions (a stated accessibility or dietary need) must not
 * disappear as a way to save money. Removing one while its need is still
 * stated is a blocking conflict; removing the need itself is the user's
 * explicit decision and is allowed.
 */
function protectedProvisionConflicts(
  before: EventRecord,
  after: EventRecord,
): Conflict[] {
  const guests = { before: before.profile.guestCount, after: after.profile.guestCount };
  const costBefore = new Map(
    forecastExpenses(before.expenses, guests.before).items.map((i) => [
      i.expenseId,
      i.forecastPaise,
    ]),
  );
  const costAfter = new Map(
    forecastExpenses(after.expenses, guests.after).items.map((i) => [
      i.expenseId,
      i.forecastPaise,
    ]),
  );
  const conflicts: Conflict[] = [];
  for (const item of before.expenses) {
    if (!item.requirement || !stillRequired(after, item.requirement)) continue;
    const next = after.expenses.find((e) => e.id === item.id);
    const dropped =
      next?.requirement === undefined || (costAfter.get(item.id) ?? 0) === 0;
    if (dropped && (costBefore.get(item.id) ?? 0) > 0) {
      conflicts.push({
        id: `conflict.required-provision-removed.${item.id}`,
        kind: 'required-provision-removed',
        severity: 'blocking',
        subjectIds: [item.id],
        message: `“${item.name}” meets a need you stated (${item.requirement.replaceAll('-', ' ')}). It cannot be removed or reduced to zero to save money while that need is still listed. Remove the need first if it no longer applies.`,
      });
    }
  }
  return conflicts;
}

/**
 * Shows what accepting a proposal would do, without changing anything.
 *
 * The result compares the event before and after: changed fields, forecast
 * and shortfall, expenses that move, tasks that are rescheduled or become
 * overdue, and conflicts that appear or go away. `today` is passed in.
 */
export function previewChanges(
  state: SavedAppState,
  change: ProposedChange,
  today: IsoDate,
): ChangePreview {
  const parsed = proposedChangeSchema.safeParse(change);
  if (!parsed.success) {
    return withoutAnalysis(change, 'invalid', [
      `The proposal is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`,
    ]);
  }

  const event = state.events.find((e) => e.profile.id === change.eventId);
  if (!event)
    return withoutAnalysis(change, 'invalid', [
      'The event for this proposal no longer exists.',
    ]);

  const before = analyzeEvent(event, today);
  if (change.baseRevision !== event.profile.revision) {
    return withoutAnalysis(
      change,
      'stale',
      [
        `The event changed after this proposal was made (revision ${change.baseRevision}, now ${event.profile.revision}). Create the proposal again from the current plan.`,
      ],
      before,
    );
  }

  const applied = tryApplyOperations(event, change.operations);
  if (!applied.ok) {
    return withoutAnalysis(
      change,
      'invalid',
      ['The change would leave the event in an invalid state.', ...applied.issues],
      before,
    );
  }
  const next = applied.record;
  const after = analyzeEvent(next, today);

  // --- Differences -----------------------------------------------------------
  const fieldChanges = FIELD_FORMATS.flatMap(({ field, label, read }) => {
    const b = read(event);
    const a = read(next);
    return a === b ? [] : [{ field, label, before: b, after: a }];
  });

  const beforeItems = new Map(before.forecast.items.map((i) => [i.expenseId, i]));
  const afterItems = new Map(after.forecast.items.map((i) => [i.expenseId, i]));
  const expenses: ChangePreview['expenses'] = { added: [], removed: [], changed: [] };
  for (const item of after.forecast.items) {
    const old = beforeItems.get(item.expenseId);
    if (!old) {
      expenses.added.push({
        id: item.expenseId,
        name: item.name,
        beforePaise: 0,
        afterPaise: item.forecastPaise,
      });
    } else if (old.forecastPaise !== item.forecastPaise) {
      expenses.changed.push({
        id: item.expenseId,
        name: item.name,
        beforePaise: old.forecastPaise,
        afterPaise: item.forecastPaise,
      });
    }
  }
  for (const old of before.forecast.items) {
    if (!afterItems.has(old.expenseId)) {
      expenses.removed.push({
        id: old.expenseId,
        name: old.name,
        beforePaise: old.forecastPaise,
        afterPaise: 0,
      });
    }
  }

  const tasks: ChangePreview['tasks'] = { added: [], removed: [], rescheduled: [] };
  for (const task of next.tasks) {
    const old = event.tasks.find((t) => t.id === task.id);
    if (!old) tasks.added.push({ id: task.id, title: task.title, dueDate: task.dueDate });
    else if (old.dueDate !== task.dueDate) {
      tasks.rescheduled.push({
        id: task.id,
        title: task.title,
        from: old.dueDate,
        to: task.dueDate,
        urgencyBefore: urgencyOf(old, today),
        urgencyAfter: urgencyOf(task, today),
      });
    }
  }
  for (const old of event.tasks) {
    if (!next.tasks.some((t) => t.id === old.id))
      tasks.removed.push({ id: old.id, title: old.title });
  }

  const beforeIds = new Set(before.conflicts.map((c) => c.id));
  const afterIds = new Set(after.conflicts.map((c) => c.id));
  const blocking: Conflict[] = [...protectedProvisionConflicts(event, next)];
  if (next.profile.date !== event.profile.date && next.profile.date < today) {
    blocking.push({
      id: 'conflict.event-date-in-past',
      kind: 'event-date-in-past',
      severity: 'blocking',
      message: `${formatDate(next.profile.date)} is in the past. An event cannot be moved to a date that has already passed.`,
    });
  }
  const conflicts = {
    introduced: [...after.conflicts.filter((c) => !beforeIds.has(c.id)), ...blocking],
    resolved: before.conflicts.filter((c) => !afterIds.has(c.id)),
    remaining: after.conflicts.filter((c) => beforeIds.has(c.id)),
  };

  const money: ChangePreview['money'] = {
    budgetBefore: before.budgetPaise,
    budgetAfter: after.budgetPaise,
    reserveBefore: before.reservePaise,
    reserveAfter: after.reservePaise,
    forecastBefore: before.forecast.forecastPaise,
    forecastAfter: after.forecast.forecastPaise,
    shortfallBefore: before.shortfallPaise,
    shortfallAfter: after.shortfallPaise,
    gapBefore: before.gapPaise,
    gapAfter: after.gapPaise,
  };

  // --- Reading-order summary -------------------------------------------------
  const summary: string[] = fieldChanges.map(
    (c) => `${c.label}: ${c.before} → ${c.after}.`,
  );
  if (money.forecastAfter !== money.forecastBefore) {
    const delta = money.forecastAfter - money.forecastBefore;
    summary.push(
      `Forecast cost ${delta > 0 ? 'rises' : 'falls'} from ${formatMoney(money.forecastBefore)} to ${formatMoney(money.forecastAfter)} (${delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta))}).`,
    );
  }
  if (money.shortfallAfter !== money.shortfallBefore) {
    summary.push(
      money.shortfallAfter > 0
        ? `The plan is ${formatMoney(money.shortfallAfter)} over the whole budget.`
        : `The plan is no longer over the whole budget.`,
    );
  }
  if (tasks.rescheduled.length > 0) {
    summary.push(
      `${tasks.rescheduled.length} ${tasks.rescheduled.length === 1 ? 'task is' : 'tasks are'} rescheduled.`,
    );
  }
  const newlyOverdue = tasks.rescheduled.filter(
    (t) => t.urgencyAfter === 'overdue' && t.urgencyBefore !== 'overdue',
  );
  if (newlyOverdue.length > 0)
    summary.push(`${newlyOverdue.length} would become overdue.`);
  if (tasks.added.length > 0)
    summary.push(
      `${tasks.added.length} ${tasks.added.length === 1 ? 'task is' : 'tasks are'} added.`,
    );
  if (tasks.removed.length > 0)
    summary.push(
      `${tasks.removed.length} ${tasks.removed.length === 1 ? 'task is' : 'tasks are'} removed.`,
    );
  for (const c of conflicts.introduced) summary.push(`New: ${c.message}`);
  for (const c of conflicts.resolved) summary.push(`Resolved: ${c.message}`);

  const blocked = blocking.length > 0;
  return {
    changeId: change.id,
    eventId: change.eventId,
    status: blocked ? 'blocked' : 'ok',
    canApply: !blocked,
    reasons: blocking.map((c) => c.message),
    before,
    after,
    fieldChanges,
    money,
    expenses,
    tasks,
    conflicts,
    options: after.options,
    summary,
  };
}
