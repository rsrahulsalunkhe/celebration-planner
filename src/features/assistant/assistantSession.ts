import { createContext, useContext } from 'react';
import type { ProposedChange } from '@/domain/types.ts';
import type { AssistantProvider, AssistantResponse } from '@/services/ai/assistant.ts';
import { guidedPlannerProvider } from '@/services/ai/guidedProvider.ts';

/**
 * Conversations live in memory for this browser session only, one per event.
 * They are never written to saved data or exports.
 */

export type ProposalState = 'pending' | 'applied' | 'dismissed';

export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | {
      id: string;
      role: 'assistant';
      response: AssistantResponse;
      /** For proposals: the engine-built change, made when the reply arrived. */
      proposal?: { change: ProposedChange; state: ProposalState; note?: string };
      /** For proposals the engine could not build. */
      problem?: string;
      /** The user message this answers, so it can be asked again. */
      askedWith: string;
    }
  | { id: string; role: 'notice'; text: string; retry?: string }
  | { id: string; role: 'error'; text: string; retry: string };

export interface AssistantSession {
  messagesFor(eventId: string): ChatMessage[];
  /** Replaces one event's conversation, keeping at most the bounded number of messages. */
  update(eventId: string, change: (messages: ChatMessage[]) => ChatMessage[]): void;
  clear(eventId: string): void;
}

export const AssistantSessionContext = createContext<AssistantSession | null>(null);

export function useAssistantSession(): AssistantSession {
  const session = useContext(AssistantSessionContext);
  if (!session) {
    throw new Error('useAssistantSession must be used inside <AssistantSessionProvider>');
  }
  return session;
}

/** Injected so tests can use a slow or failing provider. */
export const AssistantProviderContext =
  createContext<AssistantProvider>(guidedPlannerProvider);

export function useAssistantProvider(): AssistantProvider {
  return useContext(AssistantProviderContext);
}
