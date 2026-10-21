import { useEffect, useReducer, type ReactNode } from 'react';
import { loadPlannerState, savePlannerState } from '@/services/storage.ts';
import { PlannerDispatchContext, PlannerStateContext } from './plannerContext.ts';
import { plannerReducer } from './plannerReducer.ts';

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(plannerReducer, undefined, loadPlannerState);

  useEffect(() => {
    savePlannerState(state);
  }, [state]);

  return (
    <PlannerStateContext value={state}>
      <PlannerDispatchContext value={dispatch}>{children}</PlannerDispatchContext>
    </PlannerStateContext>
  );
}
