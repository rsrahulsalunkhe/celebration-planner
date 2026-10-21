import { describe, expect, it } from 'vitest';
import { category, expense, makeEvent, task, vendor } from '@/test/helpers.ts';
import { applyOperations } from './editEvent.ts';
import { generatedId } from './ids.ts';

describe('applyOperations', () => {
  it('bumps the revision once per edit, however many operations', () => {
    const next = applyOperations(makeEvent(), [
      { op: 'profile/patch', patch: { guestCount: 80 } },
      { op: 'profile/patch', patch: { city: 'Mumbai' } },
    ]);
    expect(next?.profile).toMatchObject({ guestCount: 80, city: 'Mumbai', revision: 1 });
  });

  it('does not mutate its input', () => {
    const original = makeEvent();
    const snapshot = structuredClone(original);
    applyOperations(original, [{ op: 'profile/patch', patch: { guestCount: 80 } }]);
    expect(original).toEqual(snapshot);
  });

  it('rejects an edit that would make the record invalid', () => {
    expect(
      applyOperations(makeEvent(), [{ op: 'profile/patch', patch: { guestCount: 0 } }]),
    ).toBeNull();
    expect(
      applyOperations(makeEvent(), [
        { op: 'expenses/upsert', item: expense('e', 'nope', 1) },
      ]),
    ).toBeNull();
  });

  it('is all-or-nothing: a bad operation discards the good ones too', () => {
    const result = applyOperations(makeEvent(), [
      { op: 'profile/patch', patch: { guestCount: 80 } },
      { op: 'profile/patch', patch: { budgetPaise: 0 } },
    ]);
    expect(result).toBeNull();
  });

  it('sets and clears the age band, and refuses it on non-birthdays', () => {
    const birthday = makeEvent('b', { eventType: 'birthday' });
    const withBand = applyOperations(birthday, [
      { op: 'profile/patch', patch: { ageBand: '30-49' } },
    ]);
    expect(withBand?.profile.ageBand).toBe('30-49');
    const cleared =
      withBand &&
      applyOperations(withBand, [{ op: 'profile/patch', patch: { ageBand: null } }]);
    expect(cleared && 'ageBand' in cleared.profile).toBe(false);
    expect(
      applyOperations(makeEvent(), [
        { op: 'profile/patch', patch: { ageBand: '30-49' } },
      ]),
    ).toBeNull();
    // Changing the type away from birthday while a band is set is refused.
    expect(
      withBand &&
        applyOperations(withBand, [
          { op: 'profile/patch', patch: { eventType: 'wedding' } },
        ]),
    ).toBeNull();
  });

  it('upserts replace by id and removes drop by id', () => {
    const base = applyOperations(makeEvent(), [
      { op: 'tasks/upsert', item: task('t1') },
      { op: 'tasks/upsert', item: task('t1', { title: 'Renamed', status: 'done' }) },
    ]);
    expect(base?.tasks).toHaveLength(1);
    expect(base?.tasks[0]).toMatchObject({ title: 'Renamed', status: 'done' });
    const removed = base && applyOperations(base, [{ op: 'tasks/remove', itemId: 't1' }]);
    expect(removed?.tasks).toEqual([]);
  });

  it('removing a category also removes its expenses', () => {
    const base = applyOperations(makeEvent(), [
      { op: 'budgetCategories/upsert', item: category('c1', 100) },
      { op: 'budgetCategories/upsert', item: category('c2', 100) },
      { op: 'expenses/upsert', item: expense('e1', 'c1', 10) },
      { op: 'expenses/upsert', item: expense('e2', 'c2', 10) },
    ]);
    const next =
      base && applyOperations(base, [{ op: 'budgetCategories/remove', itemId: 'c1' }]);
    expect(next?.expenses.map((e) => e.id)).toEqual(['e2']);
  });

  it('removing a vendor unlinks it instead of leaving a dangling reference', () => {
    const base = applyOperations(makeEvent(), [
      { op: 'vendors/upsert', item: vendor('v1') },
      { op: 'budgetCategories/upsert', item: category('c1', 100) },
      { op: 'expenses/upsert', item: expense('e1', 'c1', 10, { vendorId: 'v1' }) },
      { op: 'tasks/upsert', item: task('t1', { vendorId: 'v1' }) },
    ]);
    const next = base && applyOperations(base, [{ op: 'vendors/remove', itemId: 'v1' }]);
    expect(next).not.toBeNull();
    expect(next?.vendors).toEqual([]);
    expect(next?.expenses[0] && 'vendorId' in next.expenses[0]).toBe(false);
    expect(next?.tasks[0] && 'vendorId' in next.tasks[0]).toBe(false);
  });
});

describe('generatedId', () => {
  it('is deterministic, so regeneration reuses the same id', () => {
    expect(generatedId('event-1', 'task.book-venue')).toBe(
      generatedId('event-1', 'task.book-venue'),
    );
    expect(generatedId('event-1', 'task.book-venue')).not.toBe(
      generatedId('event-2', 'task.book-venue'),
    );
  });

  it('produces ids the schema accepts', () => {
    const id = generatedId(
      'event-11111111-1111-4111-8111-111111111111',
      'task.check-access',
    );
    const next = applyOperations(makeEvent(), [
      {
        op: 'tasks/upsert',
        item: task(id, { templateId: 'task.check-access', dueDateOrigin: 'generated' }),
      },
    ]);
    expect(next?.tasks[0]?.id).toBe(id);
  });
});
