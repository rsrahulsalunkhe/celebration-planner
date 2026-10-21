import { describe, expect, it } from 'vitest';
import { plannerReducer } from '@/app/state/plannerReducer.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { TODAY, presetEvent, task } from '@/test/helpers.ts';
import { applyOperations } from '../editEvent.ts';
import type { ChangeOperation, EventRecord, SavedAppState } from '../types.ts';
import { buildLedger, setTargetEdit, startingBudgetOperations } from './budget.ts';
import { isPreviewCurrent, previewScenario, type BudgetScenario } from './scenarios.ts';

const CONFIG = PLANNING_CONFIGURATION;

function apply(record: EventRecord, operations: readonly ChangeOperation[]): EventRecord {
  const next = applyOperations(record, operations);
  if (!next) throw new Error('operations did not apply');
  return next;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * A planned wedding with real records at stake: an agreed fixed venue with a
 * payment, an agreed per-guest catering rate, a manual expense, a completed
 * task and a guest.
 */
function plannedWithRecords(): EventRecord {
  const base = presetEvent('wedding');
  const record = apply(base, startingBudgetOperations(base, CONFIG, TODAY));
  const venue = record.expenses.find((e) => e.estimate.basis === 'fixed');
  const catering = record.expenses.find((e) => e.estimate.basis === 'per-guest');
  const anyCategory = record.budgetCategories[0];
  if (!venue || !catering || !anyCategory) throw new Error('fixture');
  return apply(record, [
    {
      op: 'expenses/upsert',
      item: {
        ...venue,
        commitment: { basis: 'fixed', totalPaise: 9_000_000, depositPaise: 2_000_000 },
        payments: [{ id: 'pay-1', amountPaise: 2_000_000, date: '2026-10-20' }],
      },
    },
    {
      op: 'expenses/upsert',
      item: {
        ...catering,
        commitment: { basis: 'per-guest', perGuestPaise: 60_000 },
      },
    },
    {
      op: 'expenses/upsert',
      item: {
        id: 'manual-1',
        categoryId: anyCategory.id,
        name: 'Hand-made invitations',
        estimate: { basis: 'fixed', amountPaise: 1_500_000 },
        estimateOrigin: 'user',
        commitment: null,
        payments: [],
      },
    },
    { op: 'tasks/upsert', item: task('done-task', { status: 'done' }) },
    {
      op: 'guests/upsert',
      item: {
        id: 'g1',
        name: 'A family',
        partySize: 4,
        rsvp: 'accepted',
        dietaryNeeds: [],
        accessibilityNeeds: [],
      },
    },
  ]);
}

const stateOf = (record: EventRecord): SavedAppState => ({
  activeEventId: record.profile.id,
  events: [record],
});

/** Applies a preview the way the page does: through the reducer, at the preview's revision. */
function applyPreview(record: EventRecord, scenario: BudgetScenario) {
  const preview = previewScenario(record, scenario, CONFIG);
  expect(preview.status).toBe('ok');
  const state = stateOf(record);
  const next = plannerReducer(state, {
    type: 'event/edit',
    eventId: record.profile.id,
    operations: preview.operations,
    expectedRevision: preview.baseRevision,
  });
  expect(next).not.toBe(state);
  const after = next.events[0];
  if (!after) throw new Error('event missing');
  return { preview, after };
}

describe('increasing guests (completion check)', () => {
  it('updates variable estimates, keeps fixed commitments, and totals reconcile', () => {
    const record = plannedWithRecords();
    const { preview, after } = applyPreview(record, {
      kind: 'increase-guests',
      percent: 20,
    });
    expect(after.profile.guestCount).toBe(240);

    const before = buildLedger(record, CONFIG);
    const ledger = buildLedger(after, CONFIG);
    for (const item of ledger.items) {
      const old = before.items.find((i) => i.expenseId === item.expenseId);
      if (!old) throw new Error('item disappeared');
      const active = item.commitment ?? item.estimate;
      if (active.basis === 'per-guest') {
        expect(item.forecastPaise).toBe(active.perGuestPaise * 240);
        expect(item.forecastPaise - old.forecastPaise).toBe(active.perGuestPaise * 40);
      } else {
        expect(item.forecastPaise).toBe(old.forecastPaise);
      }
    }
    const venue = ledger.items.find((i) => i.commitment?.basis === 'fixed');
    expect(venue).toMatchObject({
      forecastPaise: 9_000_000,
      committedPaise: 9_000_000,
      paidPaise: 2_000_000,
      outstandingPaise: 7_000_000,
    });
    expect(ledger.forecastPaise - before.forecastPaise).toBe(before.perGuestPaise * 40);
    expect(ledger.fixedPaise).toBe(before.fixedPaise);
    expect(ledger.reconciles).toBe(true);
    expect(ledger.headroomPaise).toBe(
      ledger.budgetPaise - ledger.reservePaise - ledger.forecastPaise,
    );

    const forecast = preview.metrics.find((m) => m.key === 'forecast');
    expect(forecast?.after).toBe(ledger.forecastPaise);
    expect(preview.tradeOffs.join(' ')).toMatch(/Fixed costs and agreed fixed totals/);
  });

  it('keeps an impossible budget visible instead of hiding the shortfall', () => {
    const record = plannedWithRecords();
    let current = record;
    for (let i = 0; i < 4; i += 1) {
      current = applyPreview(current, { kind: 'increase-guests', percent: 20 }).after;
    }
    const ledger = buildLedger(current, CONFIG);
    expect(ledger.shortfallPaise).toBeGreaterThan(0);
    expect(ledger.headroomPaise).toBeLessThan(0);
    expect(
      ledger.conflicts.find((c) => c.kind === 'forecast-exceeds-budget'),
    ).toBeDefined();
    expect(ledger.reconciles).toBe(true);
  });
});

describe('previews', () => {
  it('never change the saved plan', () => {
    const record = deepFreeze(plannedWithRecords());
    const copy = structuredClone(record);
    const scenarios: BudgetScenario[] = [
      { kind: 'reduce-budget', percent: 15 },
      { kind: 'increase-guests', percent: 20 },
      { kind: 'set-reserve', basisPoints: 2500 },
      { kind: 'prioritise', priority: 'photography', percent: 20 },
    ];
    for (const scenario of scenarios) previewScenario(record, scenario, CONFIG);
    expect(record).toEqual(copy);
  });

  it('only touch the profile and category targets', () => {
    const record = plannedWithRecords();
    for (const scenario of [
      { kind: 'reduce-budget', percent: 15 },
      { kind: 'increase-guests', percent: 20 },
      { kind: 'set-reserve', basisPoints: 500 },
      { kind: 'prioritise', priority: 'decor', percent: 20 },
    ] satisfies BudgetScenario[]) {
      const preview = previewScenario(record, scenario, CONFIG);
      expect(preview.status).toBe('ok');
      for (const op of preview.operations) {
        expect(['profile/patch', 'budgetCategories/upsert']).toContain(op.op);
      }
    }
  });

  it('become stale after another edit, and the reducer rejects a stale apply', () => {
    const record = plannedWithRecords();
    const preview = previewScenario(
      record,
      { kind: 'reduce-budget', percent: 15 },
      CONFIG,
    );
    expect(isPreviewCurrent(preview, record)).toBe(true);
    const edited = apply(record, [{ op: 'profile/patch', patch: { city: 'Mumbai' } }]);
    expect(isPreviewCurrent(preview, edited)).toBe(false);
    const state = stateOf(edited);
    const next = plannerReducer(state, {
      type: 'event/edit',
      eventId: edited.profile.id,
      operations: preview.operations,
      expectedRevision: preview.baseRevision,
    });
    expect(next).toBe(state);
  });

  it('applying preserves completed tasks, agreed costs, payments and manual records', () => {
    const record = plannedWithRecords();
    for (const scenario of [
      { kind: 'reduce-budget', percent: 15 },
      { kind: 'increase-guests', percent: 20 },
      { kind: 'set-reserve', basisPoints: 2000 },
      { kind: 'prioritise', priority: 'food', percent: 20 },
    ] satisfies BudgetScenario[]) {
      const { after } = applyPreview(record, scenario);
      expect(after.expenses).toEqual(record.expenses);
      expect(after.tasks).toEqual(record.tasks);
      expect(after.guests).toEqual(record.guests);
      expect(after.vendors).toEqual(record.vendors);
      expect(after.ideas).toEqual(record.ideas);
      expect(after.preferences).toEqual(record.preferences);
    }
  });
});

describe('reducing the budget by 15%', () => {
  it('cuts the budget exactly, re-shares unlocked targets and reports trade-offs', () => {
    const record = plannedWithRecords();
    const { preview, after } = applyPreview(record, {
      kind: 'reduce-budget',
      percent: 15,
    });
    expect(after.profile.budgetPaise).toBe(42_500_000);
    const ledger = buildLedger(after, CONFIG);
    expect(ledger.reservePaise).toBe(4_250_000);
    expect(ledger.forecastPaise).toBe(buildLedger(record, CONFIG).forecastPaise);
    expect(ledger.allocationState).toBe('balanced');
    expect(preview.targetChanges.length).toBeGreaterThan(0);
    expect(preview.tradeOffs[0]).toMatch(/does not cut costs/);
    const headroom = preview.metrics.find((m) => m.key === 'headroom');
    expect(headroom).toMatchObject({
      before: buildLedger(record, CONFIG).headroomPaise,
      after: ledger.headroomPaise,
    });
  });

  it('with locked targets that no longer fit, shows a conflict without negatives or unlocking', () => {
    const base = plannedWithRecords();
    const [first] = base.budgetCategories;
    if (!first) throw new Error('fixture');
    const edit = setTargetEdit(base, CONFIG, first.id, 43_000_000);
    if (!edit.ok) throw new Error(edit.issues.join());
    const record = apply(base, edit.operations);

    const { preview, after } = applyPreview(record, {
      kind: 'reduce-budget',
      percent: 15,
    });
    expect(after.budgetCategories.find((c) => c.id === first.id)).toMatchObject({
      plannedPaise: 43_000_000,
      plannedOrigin: 'user',
    });
    expect(after.budgetCategories.every((c) => c.plannedPaise >= 0)).toBe(true);
    expect(
      preview.conflicts.introduced.find(
        (c) => c.kind === 'locked-targets-exceed-spendable',
      ),
    ).toMatchObject({ amountPaise: 43_000_000 - 38_250_000 });
    expect(preview.tradeOffs.join(' ')).toMatch(/No target is unlocked for you/);
  });

  it('changes recommendations to close the new gap', () => {
    const record = plannedWithRecords();
    const preview = previewScenario(
      record,
      { kind: 'reduce-budget', percent: 50 },
      CONFIG,
    );
    expect(preview.after?.shortfallPaise).toBeGreaterThan(0);
    const raise = preview.recommendations.find((r) => r.id === 'option.raise-budget');
    expect(raise?.after).toMatch(/Raise the budget/);
    expect(preview.tradeOffs.join(' ')).toMatch(/over the whole budget/);
  });
});

describe('changing the reserve', () => {
  it('moves money between the reserve and unlocked targets, not the forecast', () => {
    const record = plannedWithRecords();
    const { preview, after } = applyPreview(record, {
      kind: 'set-reserve',
      basisPoints: 2500,
    });
    const ledger = buildLedger(after, CONFIG);
    expect(ledger.reservePaise).toBe(12_500_000);
    expect(ledger.targetsPaise).toBe(37_500_000);
    expect(ledger.forecastPaise).toBe(buildLedger(record, CONFIG).forecastPaise);
    expect(preview.tradeOffs[0]).toMatch(/Holding back ₹75,000 more/);
  });

  it('reports no change when the reserve is already at that level', () => {
    const record = plannedWithRecords();
    const preview = previewScenario(
      record,
      { kind: 'set-reserve', basisPoints: 1000 },
      CONFIG,
    );
    expect(preview.status).toBe('no-change');
    expect(preview.operations).toEqual([]);
  });
});

describe('giving a priority more allocation', () => {
  it('raises and locks the categories that serve it, taking exactly that from the others', () => {
    const record = plannedWithRecords();
    const { preview, after } = applyPreview(record, {
      kind: 'prioritise',
      priority: 'decor',
      percent: 20,
    });
    const gains = preview.targetChanges.filter((c) => c.afterPaise > c.beforePaise);
    const losses = preview.targetChanges.filter((c) => c.afterPaise < c.beforePaise);
    expect(gains.length).toBeGreaterThan(0);
    expect(losses.length).toBeGreaterThan(0);
    expect(gains.every((c) => c.locked)).toBe(true);
    const moved = preview.targetChanges.reduce(
      (total, c) => total + c.afterPaise - c.beforePaise,
      0,
    );
    expect(moved).toBe(0);
    const ledger = buildLedger(after, CONFIG);
    expect(ledger.targetsPaise).toBe(buildLedger(record, CONFIG).targetsPaise);
    expect(after.budgetCategories.every((c) => c.plannedPaise >= 0)).toBe(true);
    expect(preview.metrics.find((m) => m.key === 'forecast')).toMatchObject({
      before: ledger.forecastPaise,
      after: ledger.forecastPaise,
    });
  });

  it('says why nothing changes when the serving category is locked or absent', () => {
    const record = plannedWithRecords();
    const absent = previewScenario(
      record,
      { kind: 'prioritise', priority: 'sustainability', percent: 20 },
      CONFIG,
    );
    expect(absent.status).toBe('no-change');
    expect(absent.reasons[0]).toMatch(/No category in this budget serves sustainability/);

    const once = applyPreview(record, {
      kind: 'prioritise',
      priority: 'decor',
      percent: 20,
    }).after;
    const again = previewScenario(
      once,
      { kind: 'prioritise', priority: 'decor', percent: 20 },
      CONFIG,
    );
    expect(again.status).toBe('no-change');
    expect(again.reasons[0]).toMatch(/locked\. Unlock/);
  });
});
