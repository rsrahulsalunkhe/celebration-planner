import { createContext, useContext, useSyncExternalStore } from 'react';
import type {
  LocalModelController,
  LocalModelStatus,
} from '@/services/ai/local/localModel.ts';

/**
 * The one local model controller for the session. Creating it loads nothing:
 * the SDK, worker and model are only fetched when the user enables local AI.
 */
export const LocalModelContext = createContext<LocalModelController | null>(null);

export function useLocalModel(): {
  controller: LocalModelController;
  status: LocalModelStatus;
} {
  const controller = useContext(LocalModelContext);
  if (!controller)
    throw new Error('useLocalModel must be used inside <LocalModelSession>');
  const status = useSyncExternalStore(controller.subscribe, controller.getStatus);
  return { controller, status };
}
