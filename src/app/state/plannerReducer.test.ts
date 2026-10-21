import { describe, expect, it } from 'vitest';
import { sampleWedding } from '@/data/fixtures.ts';
import { emptyPlannerState } from '@/services/storage.ts';
import { plannerReducer } from './plannerReducer.ts';

describe('plannerReducer', () => {
  it('sets and clears the event without mutating prior state', () => {
    const withEvent = plannerReducer(emptyPlannerState, {
      type: 'event/set',
      event: sampleWedding,
    });
    expect(withEvent.event).toEqual(sampleWedding);
    expect(emptyPlannerState.event).toBeNull();

    expect(plannerReducer(withEvent, { type: 'event/clear' }).event).toBeNull();
  });
});
