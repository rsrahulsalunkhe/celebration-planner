import { applyOperations } from '@/domain/editEvent.ts';
import { emptySavedState } from '@/domain/eventRecord.ts';
import { LIMITS } from '@/domain/primitives.ts';
import { eventRecordSchema } from '@/domain/schemas.ts';
import type { ChangeOperation, EventRecord, SavedAppState } from '@/domain/types.ts';

/**
 * Pure and total: an action that is invalid, stale or over a limit returns the
 * same state object, so callers can detect "nothing happened" with `===`.
 * Callers validate user input first and show errors; this is the last guard.
 */
export type PlannerAction =
  | { type: 'event/create'; record: EventRecord }
  | { type: 'event/switch'; eventId: string }
  | { type: 'event/delete'; eventId: string }
  | {
      type: 'event/edit';
      eventId: string;
      operations: readonly ChangeOperation[];
      /** Reject the edit unless the event is still at this revision. */
      expectedRevision?: number;
    }
  | { type: 'state/reset' };

export function plannerReducer(
  state: SavedAppState,
  action: PlannerAction,
): SavedAppState {
  switch (action.type) {
    case 'event/create': {
      const parsed = eventRecordSchema.safeParse(action.record);
      const exists = state.events.some((e) => e.profile.id === action.record.profile.id);
      if (!parsed.success || exists || state.events.length >= LIMITS.events) return state;
      return {
        activeEventId: parsed.data.profile.id,
        events: [...state.events, parsed.data],
      };
    }
    case 'event/switch':
      if (!state.events.some((e) => e.profile.id === action.eventId)) return state;
      return state.activeEventId === action.eventId
        ? state
        : { ...state, activeEventId: action.eventId };
    case 'event/delete': {
      const events = state.events.filter((e) => e.profile.id !== action.eventId);
      if (events.length === state.events.length) return state;
      const activeEventId =
        state.activeEventId === action.eventId
          ? (events[0]?.profile.id ?? null)
          : state.activeEventId;
      return { activeEventId, events };
    }
    case 'event/edit': {
      const current = state.events.find((e) => e.profile.id === action.eventId);
      if (!current) return state;
      if (
        action.expectedRevision !== undefined &&
        action.expectedRevision !== current.profile.revision
      ) {
        return state;
      }
      const next = applyOperations(current, action.operations);
      if (!next) return state;
      return {
        ...state,
        events: state.events.map((e) => (e.profile.id === action.eventId ? next : e)),
      };
    }
    case 'state/reset':
      return emptySavedState;
  }
}
