import { describe, expect, it, vi } from 'vitest';
import { sampleWedding } from '@/data/fixtures.ts';
import {
  STORAGE_KEY,
  emptyPlannerState,
  loadPlannerState,
  savePlannerState,
} from './storage.ts';

describe('planner storage', () => {
  it('round-trips state', () => {
    expect(savePlannerState({ event: sampleWedding })).toBe(true);
    expect(loadPlannerState()).toEqual({ event: sampleWedding });
  });

  it('returns the empty state when nothing is saved', () => {
    expect(loadPlannerState()).toEqual(emptyPlannerState);
  });

  it('ignores corrupt JSON and schema-invalid data', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadPlannerState()).toEqual(emptyPlannerState);

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, state: { event: { name: 'x' } } }),
    );
    expect(loadPlannerState()).toEqual(emptyPlannerState);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    } as unknown as Storage;
    expect(loadPlannerState(broken)).toEqual(emptyPlannerState);
    expect(savePlannerState({ event: sampleWedding }, broken)).toBe(false);
  });
});
