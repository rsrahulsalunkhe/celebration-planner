import { describe, expect, it } from 'vitest';
import { plannerReducer } from '@/app/state/plannerReducer.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { TODAY, presetEvent } from '@/test/helpers.ts';
import { addDays } from '../dates.ts';
import { applyOperations, tryApplyOperations } from '../editEvent.ts';
import type {
  ChangeOperation,
  EventRecord,
  ProposedChange,
  SavedAppState,
} from '../types.ts';
import { analyzeEvent } from './analysis.ts';
import { previewChanges } from './preview.ts';
import {
  planOperationsFor,
  proposeChange,
  reconcileOperations,
  type ProposalInput,
} from './reconcile.ts';
import { generatePlan } from './generate.ts';

const CONFIG = PLANNING_CONFIGURATION;

/** A preset with its generated plan applied, as it would be after the user accepts the plan. */
function planned(id: 'wedding' | 'birthday' | 'community' = 'wedding'): EventRecord {
  const record = presetEvent(id);
  const result = tryApplyOperations(record, planOperationsFor(record, CONFIG, TODAY));
  if (!result.ok) throw new Error(`plan did not apply: ${result.issues.join('; ')}`);
  return result.record;
}
const stateOf = (record: EventRecord): SavedAppState => ({
  activeEventId: record.profile.id,
  events: [record],
});
const propose = (
  record: EventRecord,
  input: Partial<Omit<ProposalInput, 'record' | 'configuration' | 'today'>>,
): ProposedChange =>
  proposeChange({
    record,
    configuration: CONFIG,
    today: TODAY,
    id: 'change-1',
    ...input,
  });
const preview = (record: EventRecord, change: ProposedChange, today = TODAY) =>
  previewChanges(stateOf(record), change, today);

describe('applying a generated plan', () => {
  it('turns an empty event into a complete, valid one', () => {
    const record = planned();
    expect(record.profile.revision).toBe(1);
    expect(record.budgetCategories.length).toBeGreaterThan(5);
    expect(record.expenses.length).toBeGreaterThan(8);
    expect(record.tasks.length).toBe(16);
    expect(record.ideas.length).toBeGreaterThan(0);
    expect(record.budgetCategories.every((c) => c.plannedOrigin === 'generated')).toBe(
      true,
    );
    expect(record.tasks.every((t) => t.dueDateOrigin === 'generated')).toBe(true);
  });

  it('analysis of the applied plan matches the generated plan', () => {
    const record = planned();
    const analysis = analyzeEvent(record, TODAY);
    const generated = generatePlan(record, CONFIG, TODAY);
    expect(analysis.forecast.forecastPaise).toBe(generated.forecast.forecastPaise);
    expect(analysis.plannedPaise + analysis.reservePaise).toBe(
      record.profile.budgetPaise,
    );
    expect(analysis.tasks).toMatchObject({ total: 16, done: 0, overdue: 0 });
  });

  it('never rewrites an event that is history', () => {
    const record = {
      ...planned(),
      profile: { ...planned().profile, date: addDays(TODAY, -5) },
    };
    expect(reconcileOperations(record, generatePlan(record, CONFIG, TODAY))).toEqual([]);
    expect(analyzeEvent(record, TODAY).status).toBe('history');
    expect(
      analyzeEvent(record, TODAY).conflicts.some((c) => c.kind === 'event-in-history'),
    ).toBe(true);
  });
});

describe('change a constraint, inspect its consequences', () => {
  it('more guests: per-guest costs rise, fixed costs do not, and nothing is rescheduled', () => {
    const record = planned();
    const change = propose(record, { patch: { guestCount: 300 } });
    const result = preview(record, change);

    expect(result.status).toBe('ok');
    expect(result.canApply).toBe(true);
    expect(result.fieldChanges).toEqual([
      { field: 'guestCount', label: 'Guests', before: '200', after: '300' },
    ]);

    const catering = result.expenses.changed.find((e) => e.name === 'Catering');
    expect(catering).toMatchObject({
      beforePaise: 200 * 45_000,
      afterPaise: 300 * 45_000,
    });
    expect(result.expenses.changed.some((e) => e.name === 'Venue hire')).toBe(false);
    expect(result.expenses.added).toEqual([]);
    expect(result.tasks.rescheduled).toEqual([]);

    const perGuest = analyzeEvent(record, TODAY).forecast.perGuestPaise;
    expect(result.money.forecastAfter - result.money.forecastBefore).toBe(perGuest * 100);
    expect(result.summary.join(' ')).toContain('Forecast cost rises');
    expect(result.summary.join(' ')).toContain('Guests: 200 → 300');
  });

  it('a much lower budget introduces explicit conflicts, a shortfall, and options', () => {
    const record = planned();
    const result = preview(
      record,
      propose(record, { patch: { budgetPaise: 20_000_000 } }),
    );

    expect(result.status).toBe('ok'); // allowed, but the consequences are visible
    expect(result.after?.shortfallPaise).toBeGreaterThan(0);
    expect(result.money.shortfallBefore).toBe(0);
    expect(result.money.shortfallAfter).toBe(result.money.forecastAfter - 20_000_000);
    expect(result.conflicts.introduced.map((c) => c.kind)).toContain(
      'forecast-exceeds-budget',
    );
    expect(result.options.some((o) => o.kind === 'raise-budget')).toBe(true);
    expect(result.summary.join(' ')).toMatch(/over the whole budget/);
  });

  it('a raise that removes a problem shows it as resolved', () => {
    const tight = applyOperations(planned(), [
      { op: 'profile/patch', patch: { budgetPaise: 20_000_000 } },
    ]);
    if (!tight) throw new Error('fixture');
    const result = preview(tight, propose(tight, { patch: { budgetPaise: 60_000_000 } }));
    expect(result.conflicts.resolved.map((c) => c.kind)).toContain(
      'forecast-exceeds-budget',
    );
    expect(result.money.shortfallAfter).toBe(0);
    expect(result.summary.join(' ')).toContain('Resolved:');
  });

  it('a nearer date reschedules generated tasks, keeps ideal dates, and shows who becomes behind', () => {
    const record = planned();
    const result = preview(
      record,
      propose(record, { patch: { date: addDays(TODAY, 20) } }),
    );

    expect(result.status).toBe('ok');
    expect(result.tasks.rescheduled.length).toBeGreaterThan(5);
    expect(result.after?.tasks.behindIdeal).toBeGreaterThan(
      result.before?.tasks.behindIdeal ?? 0,
    );
    expect(result.summary.join(' ')).toMatch(/tasks are rescheduled/);

    // Accepting the proposal keeps each ideal deadline and never schedules prep after the event.
    const change = propose(record, { patch: { date: addDays(TODAY, 20) } });
    const next = plannerReducer(stateOf(record), {
      type: 'event/edit',
      eventId: record.profile.id,
      operations: change.operations,
      expectedRevision: change.baseRevision,
    }).events[0];
    expect(next).toBeDefined();
    for (const t of next?.tasks ?? []) {
      if (t.kind === 'preparation') expect(t.dueDate <= addDays(TODAY, 20)).toBe(true);
      expect(t.dueDate >= TODAY).toBe(true);
      expect(t.idealDueDate).toBeDefined();
    }
    const budgetTask = next?.tasks.find((t) => t.templateId === 'task.set-budget');
    expect(budgetTask?.idealDueDate).toBe(addDays(TODAY, 20 - 90));
    expect(budgetTask?.dueDate).toBe(TODAY);
  });

  it('turning on an accessibility need adds required, protected items and tasks', () => {
    const record = planned('birthday');
    const change = propose(record, {
      preferences: { ...record.preferences, accessibilityNeeds: ['wheelchair-access'] },
    });
    const result = preview(record, change);
    expect(result.expenses.added.map((e) => e.name)).toContain(
      'Ramps and wheelchair-accessible routes',
    );
    expect(result.tasks.added.map((t) => t.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('Check the entrance')]),
    );
    expect(result.fieldChanges.map((f) => f.field)).toContain('accessibilityNeeds');

    const next = tryApplyOperations(record, change.operations);
    expect(
      next.ok &&
        next.record.expenses.find((e) => e.templateId === 'expense.wheelchair-ramps')
          ?.requirement,
    ).toBe('wheelchair-access');
  });

  it('moving to an outdoor setting adds a backup task, and moving back removes it', () => {
    const record = planned();
    const out = tryApplyOperations(
      record,
      propose(record, { patch: { setting: 'outdoor' } }).operations,
    );
    if (!out.ok) throw new Error('outdoor');
    expect(out.record.tasks.some((t) => t.templateId === 'task.weather-backup')).toBe(
      true,
    );
    expect(
      out.record.expenses.some((e) => e.templateId === 'expense.weather-cover'),
    ).toBe(true);
    const back = tryApplyOperations(
      out.record,
      propose(out.record, { patch: { setting: 'indoor' } }).operations,
    );
    if (!back.ok) throw new Error('indoor');
    expect(back.record.tasks.some((t) => t.templateId === 'task.weather-backup')).toBe(
      false,
    );
    expect(
      back.record.expenses.some((e) => e.templateId === 'expense.weather-cover'),
    ).toBe(false);
  });

  it('accepting a proposal gives exactly the analysis the preview promised', () => {
    const record = planned();
    for (const patch of [
      { guestCount: 150 },
      { budgetPaise: 30_000_000 },
      { date: addDays(TODAY, 45) },
    ] as const) {
      const change = propose(record, { patch });
      const result = preview(record, change);
      const accepted = plannerReducer(stateOf(record), {
        type: 'event/edit',
        eventId: record.profile.id,
        operations: change.operations,
        expectedRevision: change.baseRevision,
      }).events[0];
      if (!accepted) throw new Error('not accepted');
      const analysis = analyzeEvent(accepted, TODAY);
      expect(analysis.forecast.forecastPaise).toBe(result.after?.forecast.forecastPaise);
      expect(analysis.conflicts.map((c) => c.id)).toEqual(
        result.after?.conflicts.map((c) => c.id),
      );
      // The plan is consistent afterwards: nothing is left to reconcile.
      expect(planOperationsFor(accepted, CONFIG, TODAY)).toEqual([]);
    }
  });

  it('previewing changes nothing and gives identical results each time', () => {
    const record = planned();
    const state = stateOf(record);
    const snapshot = structuredClone(state);
    const change = propose(record, { patch: { guestCount: 250 } });
    const a = previewChanges(state, change, TODAY);
    const b = previewChanges(state, change, TODAY);
    expect(state).toEqual(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('what the user set is respected', () => {
  it('keeps explicit estimates, commitments and statuses when constraints change', () => {
    const base = planned();
    const catering = base.expenses.find((e) => e.templateId === 'expense.catering');
    const photographer = base.expenses.find(
      (e) => e.templateId === 'expense.photographer',
    );
    const budgetTask = base.tasks.find((t) => t.templateId === 'task.set-budget');
    if (!catering || !photographer || !budgetTask) throw new Error('fixture');

    const edited = applyOperations(base, [
      // An agreed fixed quote for catering, with a deposit already paid.
      {
        op: 'expenses/upsert',
        item: {
          ...catering,
          commitment: { basis: 'fixed', totalPaise: 8_000_000, depositPaise: 2_000_000 },
          payments: [{ id: 'dep', amountPaise: 2_000_000, date: '2026-10-25' }],
        },
      },
      // The user's own estimate for the photographer.
      {
        op: 'expenses/upsert',
        item: {
          ...photographer,
          estimate: { basis: 'fixed', amountPaise: 7_000_000 },
          estimateOrigin: 'user',
        },
      },
      { op: 'tasks/upsert', item: { ...budgetTask, status: 'done' } },
    ]);
    if (!edited) throw new Error('edit');

    const result = tryApplyOperations(
      edited,
      propose(edited, { patch: { guestCount: 300, date: addDays(TODAY, 40) } })
        .operations,
    );
    if (!result.ok) throw new Error(result.issues.join());
    const next = result.record;
    const find = (id: string) => next.expenses.find((e) => e.templateId === id);

    expect(find('expense.catering')?.commitment).toEqual({
      basis: 'fixed',
      totalPaise: 8_000_000,
      depositPaise: 2_000_000,
    });
    expect(find('expense.catering')?.payments).toHaveLength(1);
    expect(find('expense.photographer')?.estimate).toEqual({
      basis: 'fixed',
      amountPaise: 7_000_000,
    });
    expect(find('expense.photographer')?.estimateOrigin).toBe('user');
    expect(next.tasks.find((t) => t.templateId === 'task.set-budget')?.status).toBe(
      'done',
    );
    expect(next.tasks.find((t) => t.templateId === 'task.set-budget')?.dueDate).toBe(
      budgetTask.dueDate,
    ); // done tasks keep their date

    // The agreed fixed quote stays at ₹80,000 for 300 guests; per-guest estimates scale.
    const forecast = analyzeEvent(next, TODAY).forecast;
    expect(
      forecast.items.find((i) => i.expenseId === find('expense.catering')?.id)
        ?.forecastPaise,
    ).toBe(8_000_000);
    expect(
      forecast.items.find((i) => i.expenseId === find('expense.beverages')?.id)
        ?.forecastPaise,
    ).toBe(300 * 6_000);
    expect(forecast.outstandingPaise).toBe(6_000_000); // deposit is part of the commitment, not extra
  });

  it('a user-fixed category target stays and the rest is re-shared around it', () => {
    const base = planned();
    const venue = base.budgetCategories.find((c) => c.templateId === 'category.venue');
    if (!venue) throw new Error('fixture');
    const edited = applyOperations(base, [
      {
        op: 'budgetCategories/upsert',
        item: { ...venue, plannedPaise: 15_000_000, plannedOrigin: 'user' },
      },
    ]);
    if (!edited) throw new Error('edit');
    const result = tryApplyOperations(
      edited,
      propose(edited, { patch: { budgetPaise: 60_000_000 } }).operations,
    );
    if (!result.ok) throw new Error(result.issues.join());
    const next = result.record;
    expect(
      next.budgetCategories.find((c) => c.templateId === 'category.venue')?.plannedPaise,
    ).toBe(15_000_000);
    const analysis = analyzeEvent(next, TODAY);
    expect(analysis.plannedPaise + analysis.reservePaise).toBe(60_000_000);
  });

  it('keeps generated items that now have something at stake instead of deleting them', () => {
    const base = planned();
    const weather = tryApplyOperations(
      base,
      propose(base, { patch: { setting: 'outdoor' } }).operations,
    );
    if (!weather.ok) throw new Error('outdoor');
    const cover = weather.record.expenses.find(
      (e) => e.templateId === 'expense.weather-cover',
    );
    if (!cover) throw new Error('fixture');
    const agreed = applyOperations(weather.record, [
      {
        op: 'expenses/upsert',
        item: { ...cover, commitment: { basis: 'fixed', totalPaise: 2_500_000 } },
      },
    ]);
    if (!agreed) throw new Error('agree');
    const back = tryApplyOperations(
      agreed,
      propose(agreed, { patch: { setting: 'indoor' } }).operations,
    );
    if (!back.ok) throw new Error(back.issues.join());
    expect(
      back.record.expenses.some((e) => e.templateId === 'expense.weather-cover'),
    ).toBe(true);
  });
});

describe('required provisions in a proposal', () => {
  const dietaryItem = (record: EventRecord) =>
    record.expenses.find((e) => e.templateId === 'expense.dietary-provision');

  it('blocks removing a required item while its need is still stated', () => {
    const record = planned(); // vegetarian
    const item = dietaryItem(record);
    if (!item) throw new Error('fixture');
    const change: ProposedChange = {
      ...propose(record, {}),
      operations: [{ op: 'expenses/remove', itemId: item.id }],
      summary: 'Cut costs',
    };
    const result = preview(record, change);
    expect(result.status).toBe('blocked');
    expect(result.canApply).toBe(false);
    expect(
      result.conflicts.introduced.find((c) => c.kind === 'required-provision-removed')
        ?.severity,
    ).toBe('blocking');
    expect(result.reasons.join(' ')).toContain('cannot be removed or reduced to zero');
  });

  it('blocks zeroing a required item or clearing its protection', () => {
    const record = planned();
    const item = dietaryItem(record);
    if (!item) throw new Error('fixture');
    for (const edit of [
      { ...item, estimate: { basis: 'fixed' as const, amountPaise: 0 } },
      (({ requirement: _r, ...rest }) => rest)(item),
    ]) {
      const result = preview(record, {
        ...propose(record, {}),
        operations: [{ op: 'expenses/upsert', item: edit }],
      });
      expect(result.status).toBe('blocked');
    }
  });

  it('allows removing the need itself, which removes its provision as the user’s explicit choice', () => {
    const record = planned();
    const change = propose(record, {
      preferences: { ...record.preferences, dietaryNeeds: [] },
    });
    const result = preview(record, change);
    expect(result.status).toBe('ok');
    expect(result.expenses.removed.map((e) => e.name)).toContain(
      'Meals for stated dietary needs',
    );
    expect(result.fieldChanges.map((f) => f.field)).toContain('dietaryNeeds');
  });

  it('does not block an ordinary edit to a required item that keeps it in the plan', () => {
    const record = planned();
    const item = dietaryItem(record);
    if (!item) throw new Error('fixture');
    const change: ProposedChange = {
      ...propose(record, {}),
      operations: [
        {
          op: 'expenses/upsert',
          item: { ...item, estimate: { basis: 'per-guest', perGuestPaise: 5000 } },
        },
      ],
    };
    expect(preview(record, change).status).toBe('ok');
  });
});

describe('proposals that cannot be applied', () => {
  it('rejects moving an event into the past', () => {
    const record = planned();
    const result = preview(
      record,
      propose(record, { patch: { date: addDays(TODAY, -1) } }),
    );
    expect(result.status).toBe('blocked');
    expect(result.canApply).toBe(false);
    expect(result.conflicts.introduced.map((c) => c.kind)).toContain(
      'event-date-in-past',
    );
    expect(result.reasons.join(' ')).toContain('in the past');
  });

  it('reports a stale proposal when the event changed since it was made', () => {
    const record = planned();
    const change = propose(record, { patch: { guestCount: 250 } });
    const moved = applyOperations(record, [
      { op: 'profile/patch', patch: { city: 'Mumbai' } },
    ]);
    if (!moved) throw new Error('fixture');
    const result = preview(moved, change);
    expect(result).toMatchObject({ status: 'stale', canApply: false, after: null });
    expect(result.reasons.join(' ')).toContain('revision 1, now 2');
    // The reducer agrees: a stale edit changes nothing.
    const state = stateOf(moved);
    expect(
      plannerReducer(state, {
        type: 'event/edit',
        eventId: moved.profile.id,
        operations: change.operations,
        expectedRevision: change.baseRevision,
      }),
    ).toBe(state);
  });

  it('reports a proposal that breaks a field rule, with the rule', () => {
    const record = planned();
    const bad: ProposedChange = {
      ...propose(record, {}),
      operations: [{ op: 'profile/patch', patch: { guestCount: 0 } }],
    };
    const result = preview(record, bad);
    expect(result.status).toBe('invalid');
    expect(result.reasons.join(' ')).toContain('Guest count must be at least 1');
  });

  it('reports a proposal that is well-formed but leaves the event invalid', () => {
    const record = planned();
    const orphan = record.expenses[0];
    if (!orphan) throw new Error('fixture');
    const bad: ProposedChange = {
      ...propose(record, {}),
      operations: [
        { op: 'expenses/upsert', item: { ...orphan, categoryId: 'no-such-category' } },
      ],
    };
    const result = preview(record, bad);
    expect(result.status).toBe('invalid');
    expect(result.canApply).toBe(false);
    expect(result.reasons.join(' ')).toContain('invalid state');
    expect(result.reasons.join(' ')).toContain('Unknown budget category');
  });

  it('reports an unknown event and a malformed proposal', () => {
    const record = planned();
    const change = propose(record, { patch: { guestCount: 250 } });
    expect(
      previewChanges({ activeEventId: null, events: [] }, change, TODAY).status,
    ).toBe('invalid');
    const empty: ProposedChange = { ...change, operations: [] as ChangeOperation[] };
    const result = preview(record, empty);
    expect(result.status).toBe('invalid');
    expect(result.reasons[0]).toContain('not valid');
  });

  it('a patch the rules cannot apply still produces a visible, invalid proposal rather than throwing', () => {
    const record = planned();
    const change = propose(record, { patch: { guestCount: 0 } });
    expect(preview(record, change).status).toBe('invalid');
  });

  it('describes the proposal in plain words', () => {
    const record = planned();
    expect(propose(record, { patch: { guestCount: 250 } }).summary).toBe(
      'Change guest count from 200 to 250',
    );
    expect(propose(record, { patch: { budgetPaise: 30_000_000 } }).summary).toBe(
      'Change budget from ₹5,00,000 to ₹3,00,000',
    );
    expect(
      propose(record, { patch: { guestCount: 250 }, summary: 'Wider guest list' })
        .summary,
    ).toBe('Wider guest list');
  });
});
