import { Send, Trash2, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import {
  useCalendar,
  usePlannerDispatch,
  usePlannerState,
} from '@/app/state/plannerContext.ts';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { FormField } from '@/components/FormField.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import fieldStyles from '@/components/Fields.module.css';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { createId } from '@/domain/ids.ts';
import { draftAlreadySaved, ideaFromDraft } from '@/domain/planning/ideas.ts';
import { previewChanges } from '@/domain/planning/preview.ts';
import type { EventRecord } from '@/domain/types.ts';
import { MAX_MESSAGE_CHARS } from '@/services/ai/assistant.ts';
import { buildContextSnapshot } from '@/services/ai/context.ts';
import { guidedPlannerProvider } from '@/services/ai/guidedProvider.ts';
import { LocalAIProvider } from '@/services/ai/local/localProvider.ts';
import { checkBeforeApply, proposalFromIntent } from '@/services/ai/proposals.ts';
import styles from './Assistant.module.css';
import {
  useAssistantSession,
  useInjectedProvider,
  type ChatMessage,
} from './assistantSession.ts';
import { LocalAICard } from './LocalAICard.tsx';
import { useLocalModel } from './localModelContext.ts';
import { Chips, MessageView } from './MessageView.tsx';

const CONFIG = PLANNING_CONFIGURATION;

export function AssistantPage() {
  return (
    <ActiveEventGate title="Assistant">
      {(event) => <AssistantWorkspace key={event.profile.id} event={event} />}
    </ActiveEventGate>
  );
}

interface Pending {
  requestId: string;
  revision: number;
  message: string;
  controller: AbortController;
}

function AssistantWorkspace({ event }: { event: EventRecord }) {
  const eventId = event.profile.id;
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const today = useCalendar().today();
  const injected = useInjectedProvider();
  const local = useLocalModel();
  const [useLocal, setUseLocal] = useState(true);
  const localProvider = useMemo(
    () => new LocalAIProvider(local.controller),
    [local.controller],
  );
  const localReady = local.status.kind === 'ready' || local.status.kind === 'generating';
  // The guided planner is always available; local AI is used only when ready and switched on.
  const provider =
    injected ?? (localReady && useLocal ? localProvider : guidedPlannerProvider);
  const [progress, setProgress] = useState('');
  const session = useAssistantSession();
  const messages = session.messagesFor(eventId);

  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [hasNewBelow, setHasNewBelow] = useState(false);

  // The latest state, for replies that arrive after a render.
  const latest = useRef({ state, today });
  useLayoutEffect(() => {
    latest.current = { state, today };
  });
  const pendingRef = useRef<Pending | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  // Leaving the event (switching, deleting or navigating away) cancels any request.
  useEffect(
    () => () => {
      pendingRef.current?.controller.abort();
      pendingRef.current = null;
    },
    [],
  );

  // Follow new messages only for someone already at the end of the conversation.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (nearBottom.current) {
      log.scrollTop = log.scrollHeight;
      setHasNewBelow(false);
    } else {
      setHasNewBelow(true);
    }
  }, [messages.length]);

  const add = (message: ChatMessage) => {
    session.update(eventId, (list) => [...list, message]);
  };

  const finish = () => {
    pendingRef.current = null;
    setPending(null);
    setProgress('');
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (text === '') {
      setInputError('Type a message or choose one of the examples.');
      return;
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      setInputError(`Keep messages under ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }
    pendingRef.current?.controller.abort();
    const current = latest.current.state.events.find((e) => e.profile.id === eventId);
    if (!current) return;
    const request = {
      requestId: createId('request'),
      eventId,
      revision: current.profile.revision,
      context: buildContextSnapshot(current, latest.current.today, CONFIG),
      message: text,
    };
    const next: Pending = {
      requestId: request.requestId,
      revision: request.revision,
      message: text,
      controller: new AbortController(),
    };
    pendingRef.current = next;
    setPending(next);
    setInputError(undefined);
    setDraft('');
    nearBottom.current = true;
    add({ id: createId('msg'), role: 'user', text });
    setAnnouncement(`${provider.info.label} is working on it.`);

    provider
      .respond(request, next.controller.signal, (preview) => {
        // Shown in the working message only; never announced token by token.
        if (pendingRef.current?.requestId === request.requestId) setProgress(preview);
      })
      .then((response) => {
        // Ignore replies to requests that were cancelled or replaced.
        if (pendingRef.current?.requestId !== response.requestId) return;
        finish();
        const now = latest.current.state.events.find((e) => e.profile.id === eventId);
        if (
          !now ||
          response.eventId !== eventId ||
          now.profile.revision !== response.revision
        ) {
          add({
            id: createId('msg'),
            role: 'notice',
            text: 'The event changed while I was answering, so that answer was discarded. Ask again to use the current details.',
            retry: text,
          });
          setAnnouncement('The answer was discarded because the event changed.');
          return;
        }
        if (response.kind === 'proposal') {
          const built = proposalFromIntent(
            latest.current.state,
            eventId,
            response.intent,
            CONFIG,
            latest.current.today,
            createId('change'),
          );
          add(
            built.ok
              ? {
                  id: createId('msg'),
                  role: 'assistant',
                  response,
                  askedWith: text,
                  proposal: { change: built.change, state: 'pending' },
                }
              : {
                  id: createId('msg'),
                  role: 'assistant',
                  response,
                  askedWith: text,
                  problem: built.reason,
                },
          );
        } else {
          add({ id: createId('msg'), role: 'assistant', response, askedWith: text });
        }
        setAnnouncement(`${response.provider.label} replied.`);
      })
      .catch((error: unknown) => {
        if (pendingRef.current?.requestId !== request.requestId) return;
        finish();
        if (error instanceof DOMException && error.name === 'AbortError') return;
        add({
          id: createId('msg'),
          role: 'error',
          text: `${provider.info.label} could not answer. Nothing was changed.`,
          retry: text,
        });
        setAnnouncement(`${provider.info.label} could not answer.`);
      });
  };

  const cancel = () => {
    pendingRef.current?.controller.abort();
    finish();
    add({ id: createId('msg'), role: 'notice', text: 'Cancelled. Nothing was changed.' });
    setAnnouncement('Cancelled.');
  };

  const setProposal = (
    messageId: string,
    change: (
      p: NonNullable<Extract<ChatMessage, { role: 'assistant' }>['proposal']>,
    ) => void,
  ) => {
    session.update(eventId, (list) =>
      list.map((m) => {
        if (m.id !== messageId || m.role !== 'assistant' || !m.proposal) return m;
        const proposal = { ...m.proposal };
        change(proposal);
        return { ...m, proposal };
      }),
    );
  };

  const apply = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (message?.role !== 'assistant' || !message.proposal) return;
    const { change } = message.proposal;
    // Check again against the event exactly as it is now.
    const check = checkBeforeApply(state, change, state.activeEventId, today);
    if (!check.ok) {
      setProposal(messageId, (p) => {
        p.note = check.reason;
      });
      setAnnouncement(check.reason);
      return;
    }
    dispatch({
      type: 'event/edit',
      eventId: change.eventId,
      operations: check.operations,
      expectedRevision: check.expectedRevision,
    });
    setProposal(messageId, (p) => {
      p.state = 'applied';
      p.note = `${change.summary}. You can see the result on the other pages.`;
    });
    setAnnouncement(`Applied: ${change.summary}.`);
  };

  /** Saves one Local AI idea as a draft on the Ideas page, once per title. */
  const saveIdea = (item: { title: string; details: string }) => {
    if (draftAlreadySaved(event, item.title)) return;
    const idea = ideaFromDraft(item, createId('idea'), today);
    const operations = [{ op: 'ideas/upsert' as const, item: idea }];
    if (!applyOperations(event, operations)) {
      setAnnouncement('That idea could not be saved. The ideas list may be full.');
      return;
    }
    dispatch({
      type: 'event/edit',
      eventId,
      operations,
      expectedRevision: event.profile.revision,
    });
    setAnnouncement(`Saved “${idea.title}” to Ideas as a Local AI draft.`);
  };

  const dismiss = (messageId: string) => {
    setProposal(messageId, (p) => {
      p.state = 'dismissed';
    });
    setAnnouncement('Dismissed. Nothing was changed.');
  };

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!pending) send(draft);
  };

  const onKeyDown = (keyEvent: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      keyEvent.key === 'Enter' &&
      !keyEvent.shiftKey &&
      !keyEvent.nativeEvent.isComposing
    ) {
      keyEvent.preventDefault();
      if (!pending) send(draft);
    }
  };

  const examples = provider.examples.map((e) => ({ label: e, message: e }));

  return (
    <>
      <PageHeader
        title="Assistant"
        badges={<Badge tone="navy">{provider.info.label}</Badge>}
        description={`For ${event.profile.title}. Ask about this event or propose a change. Nothing changes until you press Apply change.`}
      />
      <Stack>
        <Card title="About the assistant">
          <div className={styles.intro}>
            <p>
              The guided planner is always here. It follows a fixed set of commands and
              answers from this event’s details using the planner’s own rules; it is not a
              language model and does not understand open-ended requests. Answers it gives
              are labelled “Guided planner”.
            </p>
            <p>
              Optional local AI can also write ideas, invitation wording and explanations.
              Its answers are labelled “Local AI” and are unchecked drafts. Costs, totals,
              deadlines and changes always come from the planner, and nothing changes
              until you press Apply change. Neither can change payments, delete events,
              mark vendors booked or run code.
            </p>
            <p className={styles.muted}>
              This conversation is kept only while this tab is open, separately for each
              event. It is never saved or exported.
            </p>
          </div>
        </Card>

        <LocalAICard useLocal={useLocal} onUseLocalChange={setUseLocal} />

        <Card
          title="Conversation"
          actions={
            messages.length > 0 ? (
              <Button
                variant="secondary"
                icon={<Trash2 aria-hidden size={16} />}
                disabled={pending !== null}
                onClick={() => {
                  session.clear(eventId);
                  setAnnouncement('Conversation cleared.');
                }}
              >
                Clear conversation
              </Button>
            ) : null
          }
        >
          <div className="srOnly" role="status" aria-live="polite" aria-atomic="true">
            {announcement}
          </div>

          {messages.length === 0 && !pending ? (
            <div className={styles.intro}>
              <p>Nothing asked yet. Try one of these:</p>
              <Chips label="Examples" options={examples} onChoose={send} />
            </div>
          ) : (
            <div
              ref={logRef}
              className={styles.log}
              role="region"
              aria-label="Messages"
              tabIndex={0}
              onScroll={(scrollEvent) => {
                const el = scrollEvent.currentTarget;
                nearBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                if (nearBottom.current) setHasNewBelow(false);
              }}
            >
              <ol className={styles.messages}>
                {messages.map((m) => (
                  <MessageView
                    key={m.id}
                    message={m}
                    busy={pending !== null}
                    preview={
                      m.role === 'assistant' && m.proposal?.state === 'pending'
                        ? previewChanges(state, m.proposal.change, today)
                        : null
                    }
                    onSend={send}
                    onApply={apply}
                    onDismiss={dismiss}
                    onSaveIdea={saveIdea}
                    isIdeaSaved={(title) => draftAlreadySaved(event, title) !== null}
                  />
                ))}
                {pending ? (
                  <li className={styles.message} data-role="notice">
                    <span className={styles.working}>
                      {progress || `${provider.info.label} is working on it…`}
                    </span>
                  </li>
                ) : null}
              </ol>
            </div>
          )}
          {hasNewBelow ? (
            <Button
              variant="ghost"
              className={styles.jump}
              onClick={() => {
                const log = logRef.current;
                if (log) log.scrollTop = log.scrollHeight;
                nearBottom.current = true;
                setHasNewBelow(false);
              }}
            >
              New reply below
            </Button>
          ) : null}

          <form className={styles.composer} onSubmit={submit} noValidate>
            <div className={styles.composerRow}>
              <FormField
                name="assistant-message"
                label="Message"
                hint="Press Enter to send, Shift+Enter for a new line."
                error={inputError}
              >
                {(control) => (
                  <textarea
                    {...control}
                    className={fieldStyles.control}
                    rows={2}
                    maxLength={MAX_MESSAGE_CHARS}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setInputError(undefined);
                    }}
                    onKeyDown={onKeyDown}
                  />
                )}
              </FormField>
              {pending ? (
                <Button
                  variant="secondary"
                  icon={<X aria-hidden size={18} />}
                  onClick={cancel}
                >
                  {local.status.kind === 'generating' && provider === localProvider
                    ? 'Stop'
                    : 'Cancel'}
                </Button>
              ) : (
                <Button type="submit" icon={<Send aria-hidden size={18} />}>
                  Send
                </Button>
              )}
            </div>
            {messages.length > 0 ? (
              <Chips
                label="Suggestions"
                options={examples.slice(0, 4)}
                onChoose={send}
                disabled={pending !== null}
              />
            ) : null}
          </form>
        </Card>
      </Stack>
    </>
  );
}
