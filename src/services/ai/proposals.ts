import { tryApplyOperations } from '@/domain/editEvent.ts';
import { formatMoney, mulDivFloor } from '@/domain/money.ts';
import { previewChanges, type ChangePreview } from '@/domain/planning/preview.ts';
import { planOperationsFor, type ProfilePatch } from '@/domain/planning/reconcile.ts';
import type { PlanningConfiguration } from '@/domain/planning/types.ts';
import type {
  ChangeOperation,
  EventRecord,
  IsoDate,
  ProposedChange,
  SavedAppState,
} from '@/domain/types.ts';
import { changeIntentSchema, type ChangeIntent } from './assistant.ts';

/**
 * Turns an assistant's change intent into an ordinary `ProposedChange`
 * computed by the planning engine from the event as it is now, and checks a
 * proposal again before it is applied. The assistant never supplies
 * operations itself.
 */

const pct = (basisPoints: number) => `${(basisPoints / 100).toString()}%`;

function patchFor(record: EventRecord, intent: ChangeIntent): ProfilePatch {
  switch (intent.type) {
    case 'set-guest-count':
      return { guestCount: intent.guestCount };
    case 'set-budget':
      return { budgetPaise: intent.budgetPaise };
    case 'reduce-budget-percent':
      return {
        budgetPaise: Math.max(
          1,
          mulDivFloor(record.profile.budgetPaise, 100 - intent.percent, 100),
        ),
      };
    case 'set-setting':
      return { setting: intent.setting };
    case 'set-reserve':
      return { reserveBasisPoints: intent.reserveBasisPoints };
  }
}

export function describeIntent(record: EventRecord, intent: ChangeIntent): string {
  const { profile } = record;
  switch (intent.type) {
    case 'set-guest-count':
      return `Change expected guests from ${profile.guestCount} to ${intent.guestCount}`;
    case 'set-budget':
      return `Change the budget from ${formatMoney(profile.budgetPaise)} to ${formatMoney(intent.budgetPaise)}`;
    case 'reduce-budget-percent': {
      const next = patchFor(record, intent).budgetPaise ?? profile.budgetPaise;
      return `Reduce the budget by ${intent.percent}%, from ${formatMoney(profile.budgetPaise)} to ${formatMoney(next)}`;
    }
    case 'set-setting':
      return `Change the setting from ${profile.setting} to ${intent.setting}`;
    case 'set-reserve':
      return `Change the reserve to ${pct(intent.reserveBasisPoints)}`;
  }
}

/**
 * Consequences are added only for parts of the plan the event already has,
 * so a change never quietly creates a whole budget, timeline or idea list.
 */
function consequencesFor(
  before: EventRecord,
  after: EventRecord,
  configuration: PlanningConfiguration,
  today: IsoDate,
): ChangeOperation[] {
  const hasBudget = before.budgetCategories.some((c) => c.templateId !== undefined);
  const hasTimeline = before.tasks.some((t) => t.templateId !== undefined);
  const hasIdeas = before.ideas.some((i) => i.templateId !== undefined);
  return planOperationsFor(after, configuration, today).filter((op) => {
    if (op.op.startsWith('budgetCategories/') || op.op.startsWith('expenses/'))
      return hasBudget;
    if (op.op.startsWith('tasks/')) return hasTimeline;
    if (op.op.startsWith('ideas/')) return hasIdeas;
    return false;
  });
}

/**
 * Operations an assistant proposal may never contain, whatever produced it:
 * changing or removing payments, removing anything, or changing a vendor
 * (which is how "booked" would be recorded). Returns the reasons, if any.
 */
export function forbiddenOperations(
  record: EventRecord,
  operations: readonly ChangeOperation[],
): string[] {
  const problems: string[] = [];
  for (const op of operations) {
    if (op.op === 'vendors/upsert' || op.op === 'vendors/remove') {
      problems.push('An assistant cannot change vendors or mark one booked.');
    } else if (op.op === 'expenses/upsert') {
      const current = record.expenses.find((e) => e.id === op.item.id);
      const same =
        JSON.stringify(current?.payments ?? []) === JSON.stringify(op.item.payments) &&
        JSON.stringify(current?.commitment ?? null) ===
          JSON.stringify(op.item.commitment);
      if (!same) problems.push('An assistant cannot change payments or agreed amounts.');
    } else if (op.op === 'expenses/remove') {
      const current = record.expenses.find((e) => e.id === op.itemId);
      if (current && (current.payments.length > 0 || current.commitment !== null)) {
        problems.push(
          'An assistant cannot remove an expense with an agreement or payments.',
        );
      }
    } else if (op.op === 'guests/upsert' || op.op === 'guests/remove') {
      problems.push('An assistant cannot change the guest list.');
    } else if (op.op === 'runOrder/upsert' || op.op === 'runOrder/remove') {
      problems.push('An assistant cannot change the running order.');
    }
  }
  return [...new Set(problems)];
}

export type ProposalResult =
  | { ok: true; change: ProposedChange; preview: ChangePreview }
  | { ok: false; reason: string };

/** Builds the proposal and its engine preview from the event as it is now. */
export function proposalFromIntent(
  state: SavedAppState,
  eventId: string,
  intentInput: unknown,
  configuration: PlanningConfiguration,
  today: IsoDate,
  id: string,
): ProposalResult {
  const parsed = changeIntentSchema.safeParse(intentInput);
  if (!parsed.success) return { ok: false, reason: 'That change is not supported.' };
  const intent = parsed.data;
  const record = state.events.find((e) => e.profile.id === eventId);
  if (!record) return { ok: false, reason: 'That event no longer exists.' };

  const patch = patchFor(record, intent);
  const base: ChangeOperation[] = [{ op: 'profile/patch', patch }];
  const applied = tryApplyOperations(record, base);
  if (!applied.ok) return { ok: false, reason: applied.issues.join(' ') };
  const operations = [
    ...base,
    ...consequencesFor(record, applied.record, configuration, today),
  ];
  const forbidden = forbiddenOperations(record, operations);
  if (forbidden.length > 0) return { ok: false, reason: forbidden.join(' ') };

  const change: ProposedChange = {
    id,
    eventId,
    baseRevision: record.profile.revision,
    source: 'assistant',
    summary: describeIntent(record, intent).slice(0, 200),
    rationale:
      'Proposed by the guided planner. Generated values are recomputed by the planner; anything you set yourself is kept.',
    operations,
    status: 'pending',
  };
  return { ok: true, change, preview: previewChanges(state, change, today) };
}

export type ApplyCheck =
  | { ok: true; operations: ChangeOperation[]; expectedRevision: number }
  | { ok: false; reason: string };

/**
 * Checks a proposal again against the current state just before applying:
 * same event, same revision, still valid, nothing forbidden.
 */
export function checkBeforeApply(
  state: SavedAppState,
  change: ProposedChange,
  activeEventId: string | null,
  today: IsoDate,
): ApplyCheck {
  if (change.eventId !== activeEventId) {
    return { ok: false, reason: 'This proposal belongs to a different event.' };
  }
  const record = state.events.find((e) => e.profile.id === change.eventId);
  if (!record) return { ok: false, reason: 'That event no longer exists.' };
  const preview = previewChanges(state, change, today);
  if (preview.status !== 'ok') {
    return {
      ok: false,
      reason:
        preview.status === 'stale'
          ? 'The event has changed since this proposal was made, so it was not applied. Ask again to get an up-to-date proposal.'
          : (preview.reasons[0] ?? 'This proposal can no longer be applied.'),
    };
  }
  const forbidden = forbiddenOperations(record, change.operations);
  if (forbidden.length > 0) return { ok: false, reason: forbidden.join(' ') };
  return {
    ok: true,
    operations: change.operations,
    expectedRevision: change.baseRevision,
  };
}
