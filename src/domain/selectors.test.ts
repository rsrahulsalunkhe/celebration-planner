import { describe, expect, it } from 'vitest';
import { applyOperations } from './editEvent.ts';
import {
  selectBudgetSummary,
  selectCanCreateEvent,
  selectDaysUntil,
  selectGuestSummary,
  selectOverdueTasks,
  selectTaskProgress,
  selectActiveEvent,
} from './selectors.ts';
import { LIMITS } from './primitives.ts';
import { category, expense, fixedCalendar, makeEvent, task } from '@/test/helpers.ts';
import type { EventRecord } from './types.ts';

function planned(): EventRecord {
  const result = applyOperations(makeEvent('e', { budgetPaise: 10_000 }), [
    { op: 'budgetCategories/upsert', item: category('food', 4000) },
    { op: 'budgetCategories/upsert', item: category('venue', 3000) },
    {
      op: 'expenses/upsert',
      item: expense('caterer', 'food', 3500, {
        committedPaise: 3200,
        payments: [
          { id: 'p1', amountPaise: 1000, date: '2026-11-01' },
          { id: 'p2', amountPaise: 500, date: '2026-11-02' },
        ],
      }),
    },
    { op: 'expenses/upsert', item: expense('hall', 'venue', 2800) },
  ]);
  if (!result) throw new Error('fixture should be valid');
  return result;
}

describe('selectBudgetSummary', () => {
  it('keeps planned, estimated, committed and paid separate', () => {
    const summary = selectBudgetSummary(planned());
    expect(summary).toMatchObject({
      budgetPaise: 10_000,
      plannedPaise: 7000,
      unallocatedPaise: 3000,
      estimatedPaise: 6300,
      committedPaise: 3200,
      paidPaise: 1500,
    });
    const food = summary.categories.find((c) => c.category.id === 'food');
    expect(food).toMatchObject({
      plannedPaise: 4000,
      estimatedPaise: 3500,
      committedPaise: 3200,
      paidPaise: 1500,
    });
  });

  it('reports over-allocation as a negative unallocated amount', () => {
    const over = applyOperations(makeEvent('e', { budgetPaise: 1000 }), [
      { op: 'budgetCategories/upsert', item: category('a', 1500) },
    ]);
    expect(over && selectBudgetSummary(over).unallocatedPaise).toBe(-500);
  });

  it('is all zero for an event with no plan', () => {
    expect(selectBudgetSummary(makeEvent())).toMatchObject({
      plannedPaise: 0,
      estimatedPaise: 0,
      committedPaise: 0,
      paidPaise: 0,
    });
  });
});

describe('selectTaskProgress', () => {
  it('derives the percentage and is null, not zero, with no tasks', () => {
    expect(selectTaskProgress(makeEvent()).percent).toBeNull();
    const record = applyOperations(makeEvent(), [
      { op: 'tasks/upsert', item: task('a', { status: 'done' }) },
      { op: 'tasks/upsert', item: task('b') },
      { op: 'tasks/upsert', item: task('c') },
    ]);
    expect(record && selectTaskProgress(record)).toEqual({
      total: 3,
      done: 1,
      percent: 33,
    });
  });
});

describe('selectOverdueTasks', () => {
  it('excludes done tasks and tasks due today or later', () => {
    const record = applyOperations(makeEvent(), [
      { op: 'tasks/upsert', item: task('late', { dueDate: '2026-10-01' }) },
      {
        op: 'tasks/upsert',
        item: task('late-done', { dueDate: '2026-10-01', status: 'done' }),
      },
      { op: 'tasks/upsert', item: task('today', { dueDate: '2026-10-21' }) },
    ]);
    expect(record && selectOverdueTasks(record, '2026-10-21').map((t) => t.id)).toEqual([
      'late',
    ]);
  });
});

describe('selectGuestSummary', () => {
  it('counts people by party size and RSVP', () => {
    const record = applyOperations(makeEvent('e', { guestCount: 10 }), [
      {
        op: 'guests/upsert',
        item: {
          id: 'g1',
          name: 'A',
          partySize: 3,
          rsvp: 'accepted',
          dietaryNeeds: [],
          accessibilityNeeds: [],
        },
      },
      {
        op: 'guests/upsert',
        item: {
          id: 'g2',
          name: 'B',
          partySize: 2,
          rsvp: 'declined',
          dietaryNeeds: [],
          accessibilityNeeds: [],
        },
      },
    ]);
    expect(record && selectGuestSummary(record)).toEqual({
      expectedGuests: 10,
      recordedPeople: 5,
      accepted: 3,
      declined: 2,
      invited: 0,
    });
  });
});

describe('state selectors', () => {
  it('finds the active event and enforces the event limit', () => {
    const events = [makeEvent('a'), makeEvent('b')];
    expect(selectActiveEvent({ activeEventId: 'b', events })?.profile.id).toBe('b');
    expect(selectActiveEvent({ activeEventId: null, events })).toBeNull();
    expect(selectCanCreateEvent({ activeEventId: null, events })).toBe(true);
    const full = Array.from({ length: LIMITS.events }, (_, i) => makeEvent(`e${i}`));
    expect(selectCanCreateEvent({ activeEventId: null, events: full })).toBe(false);
  });

  it('counts days until the event using the injected calendar', () => {
    const profile = makeEvent('a', { date: '2026-10-31' }).profile;
    expect(selectDaysUntil(profile, fixedCalendar('2026-10-21'))).toBe(10);
    expect(selectDaysUntil(profile, fixedCalendar('2026-11-02'))).toBe(-2);
  });
});
