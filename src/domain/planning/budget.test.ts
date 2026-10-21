import { describe, expect, it } from 'vitest';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { TODAY, expense, makeEvent, presetEvent } from '@/test/helpers.ts';
import { applyOperations } from '../editEvent.ts';
import type {
  BudgetCategory,
  ChangeOperation,
  EventRecord,
  ExpenseItem,
} from '../types.ts';
import {
  accountingIssues,
  buildLedger,
  ledgerIdentities,
  rebalanceTargets,
  setReserveEdit,
  setTargetEdit,
  startingBudgetOperations,
  unlockTargetEdit,
  type BudgetEdit,
} from './budget.ts';

const CONFIG = PLANNING_CONFIGURATION;

function apply(record: EventRecord, operations: readonly ChangeOperation[]): EventRecord {
  const next = applyOperations(record, operations);
  if (!next) throw new Error('operations did not apply');
  return next;
}

function applyEdit(record: EventRecord, edit: BudgetEdit): EventRecord {
  if (!edit.ok) throw new Error(edit.issues.join('; '));
  return apply(record, edit.operations);
}

/** A preset with its starting budget applied. */
function budgeted(id: 'wedding' | 'birthday' | 'community' = 'wedding'): EventRecord {
  const record = presetEvent(id);
  return apply(record, startingBudgetOperations(record, CONFIG, TODAY));
}

const upsertExpense = (item: ExpenseItem): ChangeOperation => ({
  op: 'expenses/upsert',
  item,
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const sumTargets = (record: EventRecord) =>
  record.budgetCategories.reduce((total, c) => total + c.plannedPaise, 0);

const spendable = (record: EventRecord) => buildLedger(record, CONFIG).spendablePaise;

/** The category generated from a template. */
const byTemplate = (record: EventRecord, templateId: string): BudgetCategory => {
  const found = record.budgetCategories.find((c) => c.templateId === templateId);
  if (!found) throw new Error(`no category ${templateId}`);
  return found;
};

describe('starting budget', () => {
  it('adds only categories and expenses, with balanced generated targets', () => {
    const record = presetEvent('wedding');
    const ops = startingBudgetOperations(record, CONFIG, TODAY);
    expect(ops.length).toBeGreaterThan(0);
    expect(
      ops.every(
        (op) => op.op.startsWith('budgetCategories/') || op.op.startsWith('expenses/'),
      ),
    ).toBe(true);
    const next = apply(record, ops);
    expect(next.tasks).toEqual([]);
    expect(next.ideas).toEqual([]);
    const ledger = buildLedger(next, CONFIG);
    expect(ledger.allocationState).toBe('balanced');
    expect(ledger.targetsPaise + ledger.reservePaise).toBe(ledger.budgetPaise);
    expect(next.expenses.every((e) => e.estimateOrigin === 'generated')).toBe(true);
  });

  it('generates nothing for an event that has passed', () => {
    const past = presetEvent('birthday', '2026-01-01');
    expect(startingBudgetOperations(past, CONFIG, TODAY)).toEqual([]);
  });
});

describe('accounting model', () => {
  const base = () =>
    apply(makeEvent('e', { budgetPaise: 10_000_000, guestCount: 100 }), [
      {
        op: 'budgetCategories/upsert',
        item: { id: 'c', name: 'Food', plannedPaise: 9_000_000, plannedOrigin: 'user' },
      },
    ]);

  it('an expense contributes its agreed total when present, otherwise its estimate', () => {
    const record = apply(base(), [
      upsertExpense(expense('estimate-only', 'c', 100_000)),
      upsertExpense(
        expense('agreed', 'c', 100_000, {
          commitment: { basis: 'fixed', totalPaise: 150_000 },
        }),
      ),
      upsertExpense({
        ...expense('per-guest', 'c', 0),
        estimate: { basis: 'per-guest', perGuestPaise: 1_000 },
      }),
    ]);
    const ledger = buildLedger(record, CONFIG);
    const item = (id: string) => ledger.items.find((i) => i.expenseId === id);
    expect(item('estimate-only')?.forecastPaise).toBe(100_000);
    expect(item('agreed')?.forecastPaise).toBe(150_000); // not 100,000 + 150,000
    expect(item('agreed')?.estimatePaise).toBe(100_000);
    expect(item('per-guest')?.forecastPaise).toBe(100_000); // ₹10 × 100 guests
    expect(ledger.forecastPaise).toBe(350_000);
    expect(ledger.committedPaise).toBe(150_000);
    expect(ledger.uncommittedPaise).toBe(200_000);
  });

  it('payments sit inside the commitment: they never add to the forecast or reduce headroom', () => {
    const agreed = expense('venue', 'c', 100_000, {
      commitment: { basis: 'fixed', totalPaise: 400_000 },
    });
    const before = buildLedger(apply(base(), [upsertExpense(agreed)]), CONFIG);
    const after = buildLedger(
      apply(base(), [
        upsertExpense({
          ...agreed,
          payments: [
            { id: 'p1', amountPaise: 100_000, date: '2026-10-01' },
            { id: 'p2', amountPaise: 50_000, date: '2026-10-10' },
          ],
        }),
      ]),
      CONFIG,
    );
    expect(after.forecastPaise).toBe(before.forecastPaise);
    expect(after.headroomPaise).toBe(before.headroomPaise);
    expect(after.paidPaise).toBe(150_000);
    expect(after.outstandingPaise).toBe(250_000); // committed minus paid
    expect(after.committedPaise).toBe(after.paidPaise + after.outstandingPaise);
  });

  it('headroom is budget minus reserve minus forecast, and the reserve is never an expense', () => {
    const record = apply(base(), [upsertExpense(expense('x', 'c', 2_500_000))]);
    const ledger = buildLedger(record, CONFIG);
    expect(ledger.reservePaise).toBe(1_000_000); // 10% default
    expect(ledger.headroomPaise).toBe(10_000_000 - 1_000_000 - 2_500_000);
    const moreReserve = buildLedger(
      apply(record, [{ op: 'profile/patch', patch: { reserveBasisPoints: 3000 } }]),
      CONFIG,
    );
    expect(moreReserve.forecastPaise).toBe(ledger.forecastPaise);
    expect(moreReserve.headroomPaise).toBe(10_000_000 - 3_000_000 - 2_500_000);
  });

  it('negative headroom shows the forecast eating into the reserve or beyond the budget', () => {
    const record = apply(base(), [upsertExpense(expense('x', 'c', 12_000_000))]);
    const ledger = buildLedger(record, CONFIG);
    expect(ledger.headroomPaise).toBe(-3_000_000);
    expect(ledger.shortfallPaise).toBe(2_000_000);
    expect(ledger.conflicts.map((c) => c.kind)).toContain('forecast-exceeds-budget');
    expect(ledger.reconciles).toBe(true);
  });

  it('flags payments without a commitment and payments above the agreed amount', () => {
    expect(
      accountingIssues(
        { commitment: null, payments: [{ id: 'p', amountPaise: 1, date: TODAY }] },
        10,
      ).map((i) => i.kind),
    ).toEqual(['payments-without-commitment']);
    const over = accountingIssues(
      {
        commitment: { basis: 'fixed', totalPaise: 100 },
        payments: [{ id: 'p', amountPaise: 150, date: TODAY }],
      },
      10,
    );
    expect(over).toMatchObject([{ kind: 'paid-exceeds-commitment', amountPaise: 50 }]);
    expect(
      accountingIssues(
        {
          commitment: { basis: 'fixed', totalPaise: 100 },
          payments: [{ id: 'p', amountPaise: 100, date: TODAY }],
        },
        10,
      ),
    ).toEqual([]);
  });

  it('keeps an overpayment visible when a per-guest agreement shrinks with fewer guests', () => {
    const record = apply(base(), [
      upsertExpense({
        ...expense('meals', 'c', 0),
        commitment: { basis: 'per-guest', perGuestPaise: 1_000 },
        payments: [{ id: 'p', amountPaise: 100_000, date: TODAY }], // all 100 guests
      }),
      { op: 'profile/patch', patch: { guestCount: 80 } },
    ]);
    const ledger = buildLedger(record, CONFIG);
    expect(ledger.overpaidPaise).toBe(20_000);
    expect(ledger.outstandingPaise).toBe(0);
    expect(
      ledger.conflicts.find((c) => c.kind === 'paid-exceeds-commitment'),
    ).toMatchObject({
      severity: 'critical',
      amountPaise: 20_000,
    });
    expect(ledger.reconciles).toBe(true);
  });

  it.each(['wedding', 'birthday', 'community'] as const)(
    'every total reconciles for the %s preset, before and after edits',
    (id) => {
      const record = budgeted(id);
      const [first, second] = record.expenses;
      if (!first || !second) throw new Error('fixture');
      const edited = apply(record, [
        upsertExpense({
          ...first,
          commitment: { basis: 'fixed', totalPaise: 123_456 },
          payments: [{ id: 'p', amountPaise: 23_456, date: TODAY }],
        }),
        upsertExpense({
          ...second,
          estimate: { basis: 'per-guest', perGuestPaise: 777 },
          estimateOrigin: 'user',
        }),
      ]);
      for (const r of [record, edited]) {
        const ledger = buildLedger(r, CONFIG);
        expect(ledgerIdentities(ledger).filter((x) => !x.holds)).toEqual([]);
        expect(ledger.reconciles).toBe(true);
      }
    },
  );

  it('is pure: building a ledger never changes the record', () => {
    const record = deepFreeze(budgeted());
    const copy = structuredClone(record);
    buildLedger(record, CONFIG);
    rebalanceTargets(record, CONFIG);
    expect(record).toEqual(copy);
  });
});

describe('allocation locks', () => {
  it('a manually set target is locked and the unlocked targets re-share the rest exactly', () => {
    const record = budgeted('wedding');
    const venue = byTemplate(record, 'category.venue');
    const next = applyEdit(record, setTargetEdit(record, CONFIG, venue.id, 5_000_000));
    const lockedVenue = byTemplate(next, 'category.venue');
    expect(lockedVenue.plannedPaise).toBe(5_000_000);
    expect(lockedVenue.plannedOrigin).toBe('user');
    expect(sumTargets(next)).toBe(spendable(next));
    expect(next.budgetCategories.filter((c) => c.plannedOrigin === 'user')).toHaveLength(
      1,
    );
    // Other targets moved, the expenses did not.
    expect(next.expenses).toEqual(record.expenses);
    expect(buildLedger(next, CONFIG).allocationState).toBe('balanced');
  });

  it('rebalancing never moves a locked target', () => {
    const record = budgeted('wedding');
    const venue = byTemplate(record, 'category.venue');
    const locked = applyEdit(record, setTargetEdit(record, CONFIG, venue.id, 7_777_700));
    const cut = apply(locked, [
      { op: 'profile/patch', patch: { budgetPaise: 30_000_000 } },
    ]);
    const result = rebalanceTargets(cut, CONFIG);
    expect(result.operations.length).toBeGreaterThan(0);
    for (const op of result.operations) {
      expect(op.op).toBe('budgetCategories/upsert');
      if (op.op === 'budgetCategories/upsert') expect(op.item.id).not.toBe(venue.id);
    }
    const next = apply(cut, result.operations);
    expect(byTemplate(next, 'category.venue')).toMatchObject({
      plannedPaise: 7_777_700,
      plannedOrigin: 'user',
    });
    expect(sumTargets(next)).toBe(spendable(next));
  });

  it('Unlock returns a target to its weighted share', () => {
    const record = budgeted('wedding');
    const venue = byTemplate(record, 'category.venue');
    const locked = applyEdit(record, setTargetEdit(record, CONFIG, venue.id, 1_000_000));
    const unlocked = applyEdit(locked, unlockTargetEdit(locked, CONFIG, venue.id));
    expect(byTemplate(unlocked, 'category.venue')).toMatchObject({
      plannedOrigin: 'generated',
      plannedPaise: venue.plannedPaise,
    });
    expect(unlocked.budgetCategories.map((c) => c.plannedPaise)).toEqual(
      record.budgetCategories.map((c) => c.plannedPaise),
    );
  });

  it('cannot unlock a category that has no planning weight', () => {
    const record = apply(budgeted('birthday'), [
      {
        op: 'budgetCategories/upsert',
        item: { id: 'own', name: 'My own', plannedPaise: 100, plannedOrigin: 'user' },
      },
    ]);
    const edit = unlockTargetEdit(record, CONFIG, 'own');
    expect(edit.ok).toBe(false);
  });

  it('locked targets above the new budget give a conflict, no negatives and no silent unlock', () => {
    const record = budgeted('wedding');
    const venue = byTemplate(record, 'category.venue');
    const locked = applyEdit(record, setTargetEdit(record, CONFIG, venue.id, 30_000_000));
    const cut = apply(locked, [
      { op: 'profile/patch', patch: { budgetPaise: 20_000_000 } },
    ]);
    const result = rebalanceTargets(cut, CONFIG);
    expect(result.problems.map((p) => p.kind)).toEqual(['locked-exceeds-spendable']);
    expect(result.excessPaise).toBeGreaterThanOrEqual(30_000_000 - 18_000_000);
    const next = apply(cut, result.operations);
    expect(next.budgetCategories.every((c) => c.plannedPaise >= 0)).toBe(true);
    expect(byTemplate(next, 'category.venue')).toMatchObject({
      plannedPaise: 30_000_000,
      plannedOrigin: 'user',
    });
    const ledger = buildLedger(next, CONFIG);
    expect(ledger.allocationState).toBe('over-allocated');
    expect(
      ledger.conflicts.find((c) => c.kind === 'locked-targets-exceed-spendable'),
    ).toMatchObject({
      severity: 'critical',
      amountPaise: 30_000_000 - 18_000_000,
    });
  });

  it('keeps required provisions as floors when unlocked targets are squeezed', () => {
    const record = budgeted('community'); // wheelchair access is required
    const required = record.expenses.find((e) => e.requirement === 'wheelchair-access');
    if (!required) throw new Error('fixture');
    const others = record.budgetCategories.filter((c) => c.id !== required.categoryId);
    let squeezed = record;
    for (const c of others) {
      squeezed = apply(squeezed, [
        {
          op: 'budgetCategories/upsert',
          item: { ...c, plannedPaise: 6_000_000, plannedOrigin: 'user' },
        },
      ]);
    }
    const next = apply(squeezed, rebalanceTargets(squeezed, CONFIG).operations);
    const access = next.budgetCategories.find((c) => c.id === required.categoryId);
    const floor = buildLedger(next, CONFIG).categories.find(
      (c) => c.id === required.categoryId,
    )?.requiredFloorPaise;
    expect(floor).toBeGreaterThan(0);
    expect(access?.plannedPaise).toBeGreaterThanOrEqual(floor ?? 0);
  });

  it('when every target is locked, totals are preserved and the unallocated amount is shown', () => {
    const record = budgeted('birthday');
    let allLocked = record;
    for (const c of record.budgetCategories) {
      allLocked = apply(allLocked, [
        { op: 'budgetCategories/upsert', item: { ...c, plannedOrigin: 'user' } },
      ]);
    }
    const raised = apply(allLocked, [
      { op: 'profile/patch', patch: { budgetPaise: 6_000_000 } },
    ]);
    const result = rebalanceTargets(raised, CONFIG);
    expect(result.operations).toEqual([]);
    expect(result.sharedCount).toBe(0);
    const ledger = buildLedger(raised, CONFIG);
    expect(ledger.allLocked).toBe(true);
    expect(ledger.allocationState).toBe('unallocated');
    expect(ledger.allocationDifferencePaise).toBe(5_400_000 - 4_500_000);
    expect(result.unallocatedPaise).toBe(900_000);
    expect(ledger.conflicts.find((c) => c.kind === 'targets-unallocated')).toMatchObject({
      severity: 'warning',
    });

    const lowered = apply(allLocked, [
      { op: 'profile/patch', patch: { budgetPaise: 4_000_000 } },
    ]);
    expect(rebalanceTargets(lowered, CONFIG).operations).toEqual([]);
    const over = buildLedger(lowered, CONFIG);
    expect(over.allocationState).toBe('over-allocated');
    expect(over.allocationDifferencePaise).toBe(3_600_000 - 4_500_000);
    expect(over.categories.map((c) => c.targetPaise)).toEqual(
      record.budgetCategories.map((c) => c.plannedPaise),
    );
  });

  it('setting the reserve re-shares unlocked targets around it', () => {
    const record = budgeted('wedding');
    const next = applyEdit(record, setReserveEdit(record, CONFIG, 2000));
    expect(next.profile.reserveBasisPoints).toBe(2000);
    const ledger = buildLedger(next, CONFIG);
    expect(ledger.reservePaise).toBe(10_000_000);
    expect(ledger.targetsPaise).toBe(40_000_000);
    expect(ledger.allocationState).toBe('balanced');
  });
});
