import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { usePlannerState } from '@/app/state/plannerContext.ts';
import { MAX_CONVERSATION_MESSAGES } from '@/services/ai/assistant.ts';
import {
  AssistantSessionContext,
  type AssistantSession,
  type ChatMessage,
} from './assistantSession.ts';

/**
 * Holds each event's conversation for the session, so leaving the page keeps it.
 * A conversation goes when its event does (deleted, or all saved data cleared),
 * so nothing typed about it lingers in memory.
 */
export function AssistantSessionProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});
  const liveIds = usePlannerState()
    .events.map((e) => e.profile.id)
    .join(' ');
  const [seenIds, setSeenIds] = useState(liveIds);
  if (seenIds !== liveIds) {
    // Adjusting state while rendering, so no render shows a removed event's messages.
    setSeenIds(liveIds);
    const live = new Set(liveIds.split(' '));
    setConversations((all) =>
      Object.fromEntries(Object.entries(all).filter(([id]) => live.has(id))),
    );
  }

  const update = useCallback(
    (eventId: string, change: (messages: ChatMessage[]) => ChatMessage[]) => {
      setConversations((all) => ({
        ...all,
        [eventId]: change(all[eventId] ?? []).slice(-MAX_CONVERSATION_MESSAGES),
      }));
    },
    [],
  );
  const clear = useCallback((eventId: string) => {
    setConversations((all) => {
      const { [eventId]: _removed, ...rest } = all;
      return rest;
    });
  }, []);

  const session = useMemo<AssistantSession>(
    () => ({
      messagesFor: (eventId) => conversations[eventId] ?? [],
      update,
      clear,
    }),
    [conversations, update, clear],
  );

  return <AssistantSessionContext value={session}>{children}</AssistantSessionContext>;
}
