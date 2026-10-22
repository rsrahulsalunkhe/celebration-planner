import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { MAX_CONVERSATION_MESSAGES } from '@/services/ai/assistant.ts';
import {
  AssistantSessionContext,
  type AssistantSession,
  type ChatMessage,
} from './assistantSession.ts';

/** Holds each event's conversation for the session, so leaving the page keeps it. */
export function AssistantSessionProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});

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
