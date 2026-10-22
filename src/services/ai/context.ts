import { daysBetween } from '@/domain/dates.ts';
import { buildLedger } from '@/domain/planning/budget.ts';
import { buildTimeline } from '@/domain/planning/timeline.ts';
import type { PlanningConfiguration, Urgency } from '@/domain/planning/types.ts';
import type { EventRecord, IsoDate } from '@/domain/types.ts';
import type { ContextSnapshot } from './assistant.ts';

const URGENCY_ORDER: Record<Urgency, number> = {
  overdue: 0,
  'due-today': 1,
  'due-soon': 2,
  upcoming: 3,
  done: 4,
};

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * A bounded, read-only summary of the active event for an assistant: core
 * facts, money totals, the most pressing tasks and the main concerns. Lists
 * are capped and text is clipped, so the snapshot stays small whatever the
 * event holds. Names of guests, contact details and notes are left out.
 */
export function buildContextSnapshot(
  record: EventRecord,
  today: IsoDate,
  configuration: PlanningConfiguration,
): ContextSnapshot {
  const { profile, preferences } = record;
  const ledger = buildLedger(record, configuration);
  const timeline = buildTimeline(record, today, configuration);

  const next = timeline.items
    .filter((i) => i.task.status !== 'done')
    .sort(
      (a, b) =>
        URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
        a.task.dueDate.localeCompare(b.task.dueDate) ||
        a.task.title.localeCompare(b.task.title),
    )
    .slice(0, 5)
    .map((i) => ({
      title: clip(i.task.title, 120),
      dueDate: i.task.dueDate,
      urgency: i.urgency,
      blockedBy: i.blockers.slice(0, 3).map((b) => clip(b.title, 120)),
    }));

  const concerns = [
    ...ledger.conflicts
      .filter((c) => c.severity === 'critical' || c.severity === 'warning')
      .map((c) => c.message),
    ...(timeline.health.overloaded ? timeline.health.messages.slice(-2) : []),
  ]
    .slice(0, 5)
    .map((m) => clip(m, 300));

  return {
    eventId: profile.id,
    revision: profile.revision,
    today,
    event: {
      title: profile.title,
      eventType: profile.eventType,
      date: profile.date,
      daysUntil: daysBetween(today, profile.date),
      city: profile.city,
      guestCount: profile.guestCount,
      budgetPaise: profile.budgetPaise,
      setting: profile.setting,
      reserveBasisPoints: ledger.reserveBasisPoints,
      reserveIsDefault: ledger.reserveIsDefault,
      ageBand: profile.ageBand ?? null,
    },
    preferences: {
      priorities: [...preferences.priorities],
      dietaryNeeds: [...preferences.dietaryNeeds],
      accessibilityNeeds: [...preferences.accessibilityNeeds],
    },
    budget: {
      hasBudget: record.budgetCategories.length > 0,
      forecastPaise: ledger.forecastPaise,
      committedPaise: ledger.committedPaise,
      paidPaise: ledger.paidPaise,
      outstandingPaise: ledger.outstandingPaise,
      reservePaise: ledger.reservePaise,
      spendablePaise: ledger.spendablePaise,
      headroomPaise: ledger.headroomPaise,
      shortfallPaise: ledger.shortfallPaise,
      gapPaise: ledger.gapPaise,
      perGuestPaise: ledger.perGuestPaise,
      fixedPaise: ledger.fixedPaise,
      categories: [...ledger.categories]
        .sort((a, b) => b.forecastPaise - a.forecastPaise)
        .slice(0, 5)
        .map((c) => ({
          name: clip(c.name, 60),
          targetPaise: c.targetPaise,
          forecastPaise: c.forecastPaise,
        })),
    },
    timeline: {
      hasTimeline: record.tasks.length > 0,
      open: timeline.health.open,
      done: timeline.health.done,
      overdue: timeline.health.overdueCount,
      behind: timeline.health.catchUpCount,
      overloaded: timeline.health.overloaded,
      next,
    },
    vendors: {
      listed: record.vendors.length,
      booked: record.vendors.filter((v) => v.status === 'booked').length,
    },
    guests: {
      listedPeople: record.guests.reduce((n, g) => n + g.partySize, 0),
      acceptedPeople: record.guests
        .filter((g) => g.rsvp === 'accepted')
        .reduce((n, g) => n + g.partySize, 0),
    },
    concerns,
  };
}
