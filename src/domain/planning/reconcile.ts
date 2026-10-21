import { tryApplyOperations } from '../editEvent.ts';
import { formatDate } from '../dates.ts';
import { formatMoney } from '../money.ts';
import type {
  ChangeOperation,
  EventProfile,
  EventRecord,
  IsoDate,
  Preferences,
  ProposedChange,
} from '../types.ts';
import { generatePlan } from './generate.ts';
import type { GeneratedPlan, PlanningConfiguration } from './types.ts';

/** JSON with sorted keys, so equal objects compare equal regardless of key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

/** Drops keys whose value is `undefined`, keeping stored records free of empty keys. */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * Operations that bring a record in line with a freshly generated plan while
 * respecting what the user has done:
 *
 * - Values the user set explicitly (origin `user`), statuses, commitments,
 *   payments, vendors and notes are never overwritten.
 * - Generated values (estimates, targets, due dates) are refreshed.
 * - Generated items that no longer apply are removed only when nothing is at
 *   stake: no commitment, no payment, not started, not saved or dismissed.
 * - Done tasks keep their dates.
 *
 * For a past event this returns nothing: history is not rewritten.
 */
export function reconcileOperations(
  record: EventRecord,
  plan: GeneratedPlan,
): ChangeOperation[] {
  if (plan.status === 'history') return [];
  const ops: ChangeOperation[] = [];

  // Expenses to remove first: generated, no longer applicable, nothing at stake.
  const plannedExpenseIds = new Set(plan.expenses.map((e) => e.id));
  const removedExpenses = new Set(
    record.expenses
      .filter(
        (e) =>
          e.templateId !== undefined &&
          !plannedExpenseIds.has(e.id) &&
          e.estimateOrigin === 'generated' &&
          e.commitment === null &&
          e.payments.length === 0,
      )
      .map((e) => e.id),
  );
  for (const id of removedExpenses) ops.push({ op: 'expenses/remove', itemId: id });

  // Categories that no longer apply and have nothing left in them.
  const plannedCategoryIds = new Set(plan.budgetCategories.map((c) => c.id));
  for (const category of record.budgetCategories) {
    const stale =
      category.templateId !== undefined &&
      !plannedCategoryIds.has(category.id) &&
      category.plannedOrigin === 'generated';
    const stillUsed = record.expenses.some(
      (e) => e.categoryId === category.id && !removedExpenses.has(e.id),
    );
    if (stale && !stillUsed)
      ops.push({ op: 'budgetCategories/remove', itemId: category.id });
  }

  for (const planned of plan.budgetCategories) {
    const current = record.budgetCategories.find((c) => c.id === planned.id);
    const next = !current
      ? planned
      : current.plannedOrigin === 'generated'
        ? { ...current, plannedPaise: planned.plannedPaise, rationale: planned.rationale }
        : current;
    if (!current || !same(current, next)) {
      ops.push({ op: 'budgetCategories/upsert', item: clean(next) });
    }
  }

  for (const planned of plan.expenses) {
    const current = record.expenses.find((e) => e.id === planned.id);
    const next = !current
      ? planned
      : {
          ...current,
          estimate:
            current.estimateOrigin === 'generated' ? planned.estimate : current.estimate,
          categoryId: planned.categoryId,
          requirement: planned.requirement,
          optional: planned.optional,
          rationale: planned.rationale,
        };
    if (!current || !same(current, clean(next))) {
      ops.push({ op: 'expenses/upsert', item: clean(next) });
    }
  }

  // Tasks.
  const plannedTaskIds = new Set(plan.tasks.map((t) => t.id));
  for (const task of record.tasks) {
    const stale =
      task.templateId !== undefined &&
      !plannedTaskIds.has(task.id) &&
      task.status === 'todo' &&
      task.dueDateOrigin === 'generated' &&
      // Anything the user wrote on it keeps it.
      task.notes === undefined &&
      task.owner === undefined;
    if (stale) ops.push({ op: 'tasks/remove', itemId: task.id });
  }
  for (const planned of plan.tasks) {
    const current = record.tasks.find((t) => t.id === planned.id);
    const moves = current?.dueDateOrigin === 'generated' && current.status !== 'done';
    const next = !current
      ? planned
      : {
          ...current,
          dueDate: moves ? planned.dueDate : current.dueDate,
          idealDueDate: planned.idealDueDate,
          kind: planned.kind,
          category: planned.category,
          importance: planned.importance,
          dependsOn: planned.dependsOn,
          rationale: planned.rationale,
        };
    if (!current || !same(current, clean(next))) {
      ops.push({ op: 'tasks/upsert', item: clean(next) });
    }
  }

  // Ideas: add new suggestions; drop generated ones that no longer apply and were never acted on.
  const plannedIdeaIds = new Set(plan.ideas.map((i) => i.id));
  for (const idea of record.ideas) {
    if (idea.templateId && !plannedIdeaIds.has(idea.id) && idea.status === 'suggested') {
      ops.push({ op: 'ideas/remove', itemId: idea.id });
    }
  }
  for (const planned of plan.ideas) {
    if (!record.ideas.some((i) => i.id === planned.id)) {
      ops.push({ op: 'ideas/upsert', item: planned });
    }
  }
  return ops;
}

/** The plan in the record's current state: generate, then reconcile. */
export function planOperationsFor(
  record: EventRecord,
  configuration: PlanningConfiguration,
  today: IsoDate,
): ChangeOperation[] {
  return reconcileOperations(record, generatePlan(record, configuration, today));
}

export type ProfilePatch = Extract<ChangeOperation, { op: 'profile/patch' }>['patch'];

const LABELS: Record<string, string> = {
  guestCount: 'guest count',
  budgetPaise: 'budget',
  date: 'date',
  setting: 'setting',
  city: 'city',
  title: 'title',
  eventType: 'event type',
  reserveBasisPoints: 'reserve',
  ageBand: 'age band',
};

function describePatch(profile: EventProfile, patch: ProfilePatch): string {
  const show = (key: string, value: unknown): string => {
    if (key === 'budgetPaise' && typeof value === 'number') return formatMoney(value);
    if (key === 'date' && typeof value === 'string') return formatDate(value);
    if (key === 'reserveBasisPoints' && typeof value === 'number')
      return `${value / 100}%`;
    return String(value);
  };
  const parts = Object.entries(patch).flatMap(([key, value]) => {
    const before = (profile as Record<string, unknown>)[key];
    if (value === undefined || before === value) return [];
    return [
      `${LABELS[key] ?? key} from ${show(key, before ?? 'not set')} to ${show(key, value ?? 'not set')}`,
    ];
  });
  return parts.length > 0 ? `Change ${parts.join(', ')}` : 'Update the plan';
}

export interface ProposalInput {
  record: EventRecord;
  /** Fields of the profile to change. */
  patch?: ProfilePatch;
  /** Replacement preferences (priorities, dietary, accessibility, cultural). */
  preferences?: Preferences;
  configuration: PlanningConfiguration;
  today: IsoDate;
  /** Supplied by the caller, because creating ids is not pure. */
  id: string;
  summary?: string;
  rationale?: string;
}

/**
 * Builds a proposal for changing a constraint. It carries the change itself
 * plus every consequence for generated values (re-allocated targets,
 * re-priced per-guest items, rescheduled tasks, items that start or stop
 * applying), so accepting it applies them in one validated step.
 */
export function proposeChange(input: ProposalInput): ProposedChange {
  const { record, patch, preferences, configuration, today } = input;
  const base: ChangeOperation[] = [
    ...(patch ? [{ op: 'profile/patch' as const, patch }] : []),
    ...(preferences ? [{ op: 'preferences/set' as const, preferences }] : []),
  ];

  // Compute consequences from the record as it would be after the base change.
  const applied = tryApplyOperations(record, base);
  const consequences = applied.ok
    ? planOperationsFor(applied.record, configuration, today)
    : [];

  return {
    id: input.id,
    eventId: record.profile.id,
    baseRevision: record.profile.revision,
    source: 'rules',
    summary:
      input.summary ?? (patch ? describePatch(record.profile, patch) : 'Update the plan'),
    rationale:
      input.rationale ??
      'Generated values are recomputed from the new constraint. Anything you set yourself is kept.',
    operations: [...base, ...consequences],
    status: 'pending',
  };
}
