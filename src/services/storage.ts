import { persistedPlannerSchema } from '@/domain/schemas.ts';
import type { PersistedPlanner, PlannerState } from '@/domain/types.ts';

export const STORAGE_KEY = 'celebration-planner:v1';

export const emptyPlannerState: PlannerState = { event: null };

/**
 * Reads saved state. Anything missing, corrupt, from a newer version, or
 * blocked by the browser falls back to the empty state rather than throwing.
 */
export function loadPlannerState(storage: Storage = window.localStorage): PlannerState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return emptyPlannerState;
    const parsed = persistedPlannerSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.state : emptyPlannerState;
  } catch {
    return emptyPlannerState;
  }
}

/** Returns `false` when the write fails (private mode, quota exceeded). */
export function savePlannerState(
  state: PlannerState,
  storage: Storage = window.localStorage,
): boolean {
  const envelope: PersistedPlanner = { version: 1, state };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}
