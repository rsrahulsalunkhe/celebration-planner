import { createContext, useContext, type Dispatch } from 'react';
import { systemCalendar, type CalendarHelper } from '@/domain/dates.ts';
import type { SavedAppState } from '@/domain/types.ts';
import type { PersistenceSnapshot } from '@/services/persistence.ts';
import type { PlannerAction } from './plannerReducer.ts';

export const PlannerStateContext = createContext<SavedAppState | null>(null);
export const PlannerDispatchContext = createContext<Dispatch<PlannerAction> | null>(null);

export function usePlannerState(): SavedAppState {
  const state = useContext(PlannerStateContext);
  if (!state) throw new Error('usePlannerState must be used inside <PlannerProvider>');
  return state;
}

export function usePlannerDispatch(): Dispatch<PlannerAction> {
  const dispatch = useContext(PlannerDispatchContext);
  if (!dispatch)
    throw new Error('usePlannerDispatch must be used inside <PlannerProvider>');
  return dispatch;
}

/** Injected so tests can pin "today". Defaults to the real calendar. */
export const CalendarContext = createContext<CalendarHelper>(systemCalendar);

export function useCalendar(): CalendarHelper {
  return useContext(CalendarContext);
}

export interface PersistenceApi {
  snapshot: PersistenceSnapshot;
  /** Unreadable saved text available for download, if any. */
  backupText: string | null;
  retrySave: () => void;
  /** Removes this app's saved keys and resets the open events. Returns success. */
  clearSavedData: () => boolean;
  dismissNotice: () => void;
}

export const PersistenceContext = createContext<PersistenceApi | null>(null);

export function usePersistence(): PersistenceApi {
  const api = useContext(PersistenceContext);
  if (!api) throw new Error('usePersistence must be used inside <PlannerProvider>');
  return api;
}
