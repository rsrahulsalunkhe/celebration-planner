import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { PersistenceStore } from '@/services/persistence.ts';
import { getBrowserStorage, type StorageLike } from '@/services/storage.ts';
import {
  PersistenceContext,
  PlannerDispatchContext,
  PlannerStateContext,
  type PersistenceApi,
} from './plannerContext.ts';
import { plannerReducer } from './plannerReducer.ts';

interface PlannerProviderProps {
  children: ReactNode;
  /**
   * Storage to use. Read once at mount. `undefined` means the browser's
   * localStorage; `null` means "unavailable" (used by tests).
   */
  storage?: StorageLike | null;
}

export function PlannerProvider({ children, storage }: PlannerProviderProps) {
  const [store] = useState(
    () => new PersistenceStore(storage === undefined ? getBrowserStorage() : storage),
  );
  const [state, dispatch] = useReducer(plannerReducer, store.initialState);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    store.save(state);
  }, [store, state]);

  const retrySave = useCallback(() => {
    store.retry(state);
  }, [store, state]);

  const clearSavedData = useCallback(() => {
    const cleared = store.clearSavedData();
    if (cleared) dispatch({ type: 'state/reset' });
    return cleared;
  }, [store]);

  const persistence = useMemo<PersistenceApi>(
    () => ({
      snapshot,
      backupText: store.getBackupText(),
      retrySave,
      clearSavedData,
      dismissNotice: () => {
        store.dismissNotice();
      },
    }),
    [snapshot, store, retrySave, clearSavedData],
  );

  return (
    <PlannerStateContext value={state}>
      <PlannerDispatchContext value={dispatch}>
        <PersistenceContext value={persistence}>{children}</PersistenceContext>
      </PlannerDispatchContext>
    </PlannerStateContext>
  );
}
