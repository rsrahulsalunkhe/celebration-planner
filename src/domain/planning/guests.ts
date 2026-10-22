import { tryApplyOperations } from '../editEvent.ts';
import { formatMoney } from '../money.ts';
import { LIMITS } from '../primitives.ts';
import type { ChangeOperation, EventRecord, IsoDate } from '../types.ts';
import { buildLedger, type BudgetLedger } from './budget.ts';
import { withTimelineRegeneration } from './timeline.ts';
import type { PlanningConfiguration } from './types.ts';

/** Negative amounts with a real minus sign, which reads correctly aloud. */
const signedMoney = (paise: number): string =>
  paise < 0 ? `−${formatMoney(-paise)}` : formatMoney(paise);

/**
 * The expected guest count is the forecasting input. Replies recorded in the
 * guest list are counted separately and never change it on their own; the
 * organizer can preview a new count and apply it explicitly.
 */

export interface GuestCountSuggestion {
  key: 'accepted' | 'not-declined';
  label: string;
  count: number;
}

/** Counts the organizer may want to forecast with, from recorded replies. */
export function guestCountSuggestions(record: EventRecord): GuestCountSuggestion[] {
  const people = (keep: (rsvp: string) => boolean) =>
    record.guests.filter((g) => keep(g.rsvp)).reduce((n, g) => n + g.partySize, 0);
  return [
    {
      key: 'accepted',
      label: 'People who accepted',
      count: people((r) => r === 'accepted'),
    },
    {
      key: 'not-declined',
      label: 'Accepted plus no reply yet',
      count: people((r) => r !== 'declined'),
    },
  ];
}

export interface GuestCountPreview {
  eventId: string;
  baseRevision: number;
  from: number;
  to: number;
  operations: ChangeOperation[];
  before: BudgetLedger;
  after: BudgetLedger;
  /** Deadlines that move because steps start or stop applying. */
  movedDeadlines: number;
  lines: string[];
}

export type GuestCountResult =
  { ok: true; preview: GuestCountPreview } | { ok: false; reason: string };

export function previewGuestCount(
  record: EventRecord,
  to: number,
  configuration: PlanningConfiguration,
  today: IsoDate,
): GuestCountResult {
  const from = record.profile.guestCount;
  if (!Number.isInteger(to) || to < 1 || to > LIMITS.guestCount) {
    return {
      ok: false,
      reason: `The expected guest count must be a whole number from 1 to ${LIMITS.guestCount}.`,
    };
  }
  if (to === from) {
    return { ok: false, reason: `The expected guest count is already ${from}.` };
  }
  const edit = withTimelineRegeneration(
    record,
    [{ op: 'profile/patch', patch: { guestCount: to } }],
    configuration,
    today,
  );
  const applied = tryApplyOperations(record, edit.operations);
  if (!applied.ok) return { ok: false, reason: applied.issues.join(' ') };

  const before = buildLedger(record, configuration);
  const after = buildLedger(applied.record, configuration);
  const forecastDelta = after.forecastPaise - before.forecastPaise;
  const lines = [
    `Expected guests: ${from} → ${to}. This is the number every per-guest cost uses.`,
    forecastDelta === 0
      ? 'The forecast does not change: nothing in the budget is priced per guest yet.'
      : `Forecast: ${formatMoney(before.forecastPaise)} → ${formatMoney(after.forecastPaise)} (${forecastDelta > 0 ? '+' : '−'}${formatMoney(Math.abs(forecastDelta))}), from per-guest items at ${formatMoney(after.perGuestPaise)} per guest. Fixed amounts stay the same.`,
    `Headroom: ${signedMoney(before.headroomPaise)} → ${signedMoney(after.headroomPaise)}.`,
    'Category targets are not re-shared; use Rebalance on the Budget page if you want them to follow.',
  ];
  if (edit.moved > 0) {
    lines.push(
      `${edit.moved} planned deadlines move because steps start or stop applying.`,
    );
  }
  return {
    ok: true,
    preview: {
      eventId: record.profile.id,
      baseRevision: record.profile.revision,
      from,
      to,
      operations: edit.operations,
      before,
      after,
      movedDeadlines: edit.moved,
      lines,
    },
  };
}
