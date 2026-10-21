import { describe, expect, it } from 'vitest';
import { emptySavedState } from '@/domain/eventRecord.ts';
import { LIMITS } from '@/domain/primitives.ts';
import type { SavedAppState } from '@/domain/types.ts';
import { makeEvent } from '@/test/helpers.ts';
import { plannerReducer } from './plannerReducer.ts';

const create = (state: SavedAppState, id: string) =>
  plannerReducer(state, { type: 'event/create', record: makeEvent(id) });

describe('plannerReducer', () => {
  it('creates events and makes the newest active', () => {
    const one = create(emptySavedState, 'a');
    const two = create(one, 'b');
    expect(two.events.map((e) => e.profile.id)).toEqual(['a', 'b']);
    expect(two.activeEventId).toBe('b');
    expect(emptySavedState.events).toEqual([]);
  });

  it('refuses duplicate ids, invalid records and events beyond the limit', () => {
    const one = create(emptySavedState, 'a');
    expect(create(one, 'a')).toBe(one);
    const invalid = makeEvent('x');
    invalid.profile.guestCount = 0;
    expect(plannerReducer(one, { type: 'event/create', record: invalid })).toBe(one);

    let full = emptySavedState;
    for (let i = 0; i < LIMITS.events; i += 1) full = create(full, `e${i}`);
    expect(full.events).toHaveLength(LIMITS.events);
    expect(create(full, 'one-too-many')).toBe(full);
  });

  it('switches between events and ignores unknown ids', () => {
    const state = create(create(emptySavedState, 'a'), 'b');
    const switched = plannerReducer(state, { type: 'event/switch', eventId: 'a' });
    expect(switched.activeEventId).toBe('a');
    expect(plannerReducer(switched, { type: 'event/switch', eventId: 'a' })).toBe(
      switched,
    );
    expect(plannerReducer(switched, { type: 'event/switch', eventId: 'zzz' })).toBe(
      switched,
    );
  });

  it('deletes events and moves the active event when needed', () => {
    const state = create(create(emptySavedState, 'a'), 'b'); // b is active
    const afterB = plannerReducer(state, { type: 'event/delete', eventId: 'b' });
    expect(afterB.activeEventId).toBe('a');
    const afterA = plannerReducer(afterB, { type: 'event/delete', eventId: 'a' });
    expect(afterA).toEqual({ activeEventId: null, events: [] });
    const keepsActive = plannerReducer(state, { type: 'event/delete', eventId: 'a' });
    expect(keepsActive.activeEventId).toBe('b');
    expect(plannerReducer(state, { type: 'event/delete', eventId: 'zzz' })).toBe(state);
  });

  it('edits through operations and bumps the revision', () => {
    const state = create(emptySavedState, 'a');
    const next = plannerReducer(state, {
      type: 'event/edit',
      eventId: 'a',
      operations: [{ op: 'profile/patch', patch: { guestCount: 75 } }],
    });
    expect(next.events[0]?.profile).toMatchObject({ guestCount: 75, revision: 1 });
    expect(state.events[0]?.profile.guestCount).toBe(50);
  });

  it('rejects stale edits, invalid edits and unknown events with the same state object', () => {
    const state = create(emptySavedState, 'a');
    const edit = (patch: object, expectedRevision?: number, eventId = 'a') =>
      plannerReducer(state, {
        type: 'event/edit',
        eventId,
        operations: [{ op: 'profile/patch', patch }],
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      });
    expect(edit({ guestCount: 60 }, 5)).toBe(state); // stale revision
    expect(edit({ guestCount: 0 })).toBe(state); // invalid
    expect(edit({ guestCount: 60 }, undefined, 'zzz')).toBe(state); // unknown
    expect(edit({ guestCount: 60 }, 0)).not.toBe(state); // matching revision applies
  });

  it('resets to the canonical empty state', () => {
    expect(plannerReducer(create(emptySavedState, 'a'), { type: 'state/reset' })).toBe(
      emptySavedState,
    );
  });
});
