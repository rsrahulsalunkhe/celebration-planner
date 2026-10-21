import { createContext, useContext, type Dispatch } from 'react';
import type { PlannerState } from '@/domain/types.ts';
import type { PlannerAction } from './plannerReducer.ts';

export const PlannerStateContext = createContext<PlannerState | null>(null);
export const PlannerDispatchContext = createContext<Dispatch<PlannerAction> | null>(null);

export function usePlannerState(): PlannerState {
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
