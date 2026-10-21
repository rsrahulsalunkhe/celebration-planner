import type { CelebrationEvent, PlannerState } from '@/domain/types.ts';

export type PlannerAction =
  { type: 'event/set'; event: CelebrationEvent } | { type: 'event/clear' };

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'event/set':
      return { ...state, event: action.event };
    case 'event/clear':
      return { ...state, event: null };
  }
}
