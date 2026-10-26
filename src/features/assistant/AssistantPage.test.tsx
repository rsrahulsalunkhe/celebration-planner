import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '@/app/AppRoutes.tsx';
import { CalendarContext, usePlannerDispatch } from '@/app/state/plannerContext.ts';
import { PlannerProvider } from '@/app/state/PlannerProvider.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { startingBudgetOperations } from '@/domain/planning/budget.ts';
import { savedEnvelopeSchema } from '@/domain/schemas.ts';
import type { EventRecord } from '@/domain/types.ts';
import type {
  AssistantProvider,
  AssistantRequest,
  AssistantResponse,
} from '@/services/ai/assistant.ts';
import { guidedPlannerProvider } from '@/services/ai/guidedProvider.ts';
import { SAVED_STATE_KEY, serializeSavedState } from '@/services/storage.ts';
import { MemoryStorage, TODAY, fixedCalendar, presetEvent } from '@/test/helpers.ts';
import { AssistantProviderContext } from './assistantSession.ts';

function budgeted(id: 'wedding' | 'birthday' = 'wedding', eventId?: string): EventRecord {
  const base = presetEvent(id);
  const record = eventId ? { ...base, profile: { ...base.profile, id: eventId } } : base;
  const next = applyOperations(
    record,
    startingBudgetOperations(record, PLANNING_CONFIGURATION, TODAY),
  );
  if (!next) throw new Error('fixture');
  return next;
}

/** A test-only control that edits the event from outside the assistant. */
function EditCity({ eventId }: { eventId: string }) {
  const dispatch = usePlannerDispatch();
  return (
    <button
      type="button"
      onClick={() => {
        dispatch({
          type: 'event/edit',
          eventId,
          operations: [{ op: 'profile/patch', patch: { city: 'Mumbai' } }],
        });
      }}
    >
      Test: change the city
    </button>
  );
}

function renderAssistant(
  records: EventRecord[] = [budgeted()],
  provider: AssistantProvider = guidedPlannerProvider,
) {
  const storage = new MemoryStorage();
  const [first] = records;
  if (!first) throw new Error('no event');
  storage.data.set(
    SAVED_STATE_KEY,
    serializeSavedState({ activeEventId: first.profile.id, events: records }),
  );
  render(
    <MemoryRouter initialEntries={['/assistant']}>
      <CalendarContext value={fixedCalendar(TODAY)}>
        <PlannerProvider storage={storage}>
          <AssistantProviderContext value={provider}>
            <AppRoutes />
            <EditCity eventId={first.profile.id} />
          </AssistantProviderContext>
        </PlannerProvider>
      </CalendarContext>
    </MemoryRouter>,
  );
  return storage;
}

function saved(storage: MemoryStorage, index = 0): EventRecord {
  const raw = storage.data.get(SAVED_STATE_KEY);
  if (raw === undefined) throw new Error('nothing saved');
  const event = savedEnvelopeSchema.parse(JSON.parse(raw)).data.events[index];
  if (!event) throw new Error('no event');
  return event;
}

const log = () => screen.getByRole('region', { name: 'Messages' });
const announced = () =>
  screen
    .getAllByRole('status')
    .map((s) => s.textContent)
    .join(' ');

async function say(text: string) {
  const box = screen.getByRole('textbox', { name: 'Message' });
  await userEvent.type(box, text);
  await userEvent.keyboard('{Enter}');
}

/** A provider whose answer arrives only when the test says so. */
function slowProvider() {
  const calls: {
    request: AssistantRequest;
    signal: AbortSignal | undefined;
    resolve: () => void;
  }[] = [];
  const provider: AssistantProvider = {
    info: { id: 'slow', label: 'Guided planner' },
    examples: guidedPlannerProvider.examples,
    respond(request, signal) {
      return new Promise<AssistantResponse>((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Cancelled', 'AbortError'));
        });
        calls.push({
          request,
          signal,
          resolve: () => {
            void guidedPlannerProvider.respond(request).then(resolve);
          },
        });
      });
    },
  };
  return { provider, calls };
}

describe('the assistant page', () => {
  it('labels the guided planner honestly and shows supported examples', () => {
    renderAssistant();
    expect(screen.getByText('Guided planner', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/it is not a language model/)).toBeInTheDocument();
    const examples = screen.getByRole('list', { name: 'Examples' });
    expect(
      within(examples).getByRole('button', { name: 'Set guests to 120.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/never saved or exported/)).toBeInTheDocument();
  });

  it('proposes a change with the planner’s calculation and changes nothing until Apply (completion check)', async () => {
    const storage = renderAssistant();
    await userEvent.click(screen.getByRole('button', { name: 'Set guests to 120.' }));
    const reply = within(log()).getByText('Proposed change').closest('li');
    if (!reply) throw new Error('no reply');
    const table = within(reply).getByRole('table', { name: /Planner calculation/ });
    expect(within(table).getByRole('row', { name: /Forecast/ })).toHaveTextContent(
      /₹4,39,000.*₹/,
    );
    expect(within(reply).getByText('Guests: 200 → 120')).toBeInTheDocument();
    expect(saved(storage).profile.guestCount).toBe(200);
    expect(announced()).toMatch(/Guided planner replied/);

    await userEvent.click(within(reply).getByRole('button', { name: 'Apply change' }));
    expect(saved(storage).profile.guestCount).toBe(120);
    expect(within(reply).getByText('Applied.')).toBeInTheDocument();
    expect(within(reply).queryByRole('button', { name: 'Apply change' })).toBeNull();
  });

  it('submits with Enter, keeps Shift+Enter for a new line, and keeps focus in the box', async () => {
    renderAssistant();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'Explain my budget.{Shift>}{Enter}{/Shift}');
    expect(box).toHaveValue('Explain my budget.\n');
    await userEvent.keyboard('{Enter}');
    expect(
      within(log()).getByRole('heading', { name: 'Your budget' }),
    ).toBeInTheDocument();
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
  });

  it('asks instead of guessing a unit, and the chosen answer leads to a proposal', async () => {
    const storage = renderAssistant();
    await say('Reduce my budget by 15');
    expect(within(log()).getByText(/Did you mean 15% or ₹15\?/)).toBeInTheDocument();
    await userEvent.click(within(log()).getByRole('button', { name: '15%' }));
    expect(within(log()).getByText('Budget: ₹5,00,000 → ₹4,25,000')).toBeInTheDocument();
    expect(saved(storage).profile.budgetPaise).toBe(50_000_000);
  });

  it('offers the right form for unsupported requests', async () => {
    renderAssistant();
    await say('Mark the caterer as booked');
    expect(within(log()).getByRole('link', { name: 'Open Vendors' })).toHaveAttribute(
      'href',
      '/vendors',
    );
  });

  it('renders typed and generated text as text, never as HTML', async () => {
    renderAssistant();
    await say('<img src=x onerror=alert(1)>');
    expect(within(log()).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(log().querySelector('img')).toBeNull();
  });

  it('marks an older proposal stale once another change is applied', async () => {
    const storage = renderAssistant();
    await say('Reduce my budget by 15%');
    await say('Set guests to 120');
    const [budgetReply, guestReply] = within(log())
      .getAllByText('Proposed change')
      .map((b) => b.closest('li'));
    if (!budgetReply || !guestReply) throw new Error('replies');
    await userEvent.click(
      within(guestReply).getByRole('button', { name: 'Apply change' }),
    );
    expect(
      within(budgetReply).getByText(/event has changed since this was proposed/),
    ).toBeInTheDocument();
    expect(
      within(budgetReply).queryByRole('button', { name: 'Apply change' }),
    ).toBeNull();
    expect(saved(storage).profile.budgetPaise).toBe(50_000_000);
    await userEvent.click(
      within(budgetReply).getByRole('button', {
        name: 'Ask again with the current event',
      }),
    );
    const fresh = within(log()).getAllByText('Proposed change').at(-1)?.closest('li');
    if (!fresh) throw new Error('fresh reply');
    await userEvent.click(within(fresh).getByRole('button', { name: 'Apply change' }));
    expect(saved(storage).profile).toMatchObject({
      budgetPaise: 42_500_000,
      guestCount: 120,
    });
  });
});

describe('loading, cancelling and stale replies', () => {
  it('shows a working state and discards a reply when the event changed meanwhile', async () => {
    const { provider, calls } = slowProvider();
    const storage = renderAssistant([budgeted()], provider);
    await say('Set guests to 120');
    expect(within(log()).getByText(/is working on it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Test: change the city' }));
    calls[0]?.resolve();
    expect(
      await within(log()).findByText(/The event changed while I was answering/),
    ).toBeInTheDocument();
    expect(within(log()).queryByText('Proposed change')).toBeNull();
    expect(saved(storage).profile.guestCount).toBe(200);
  });

  it('cancels a request', async () => {
    const { provider, calls } = slowProvider();
    renderAssistant([budgeted()], provider);
    await say('Explain my budget');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(
      within(log()).getByText('Cancelled. Nothing was changed.'),
    ).toBeInTheDocument();
  });

  it('keeps conversations per event and drops a reply meant for another event', async () => {
    const { provider, calls } = slowProvider();
    const a = budgeted('wedding');
    const b = budgeted('birthday', 'event-b');
    renderAssistant([a, b], provider);
    await say('Explain my budget');
    await userEvent.selectOptions(screen.getByLabelText('Active event'), 'event-b');
    expect(calls[0]?.signal?.aborted).toBe(true);
    calls[0]?.resolve();
    // Event B starts with its own empty conversation.
    expect(await screen.findByRole('list', { name: 'Examples' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Messages' })).toBeNull();

    await say('Explain my budget');
    calls[1]?.resolve();
    // The birthday's own figures, not the wedding's.
    expect(
      await within(log()).findByText(/^Headroom = budget ₹50,000 − reserve ₹5,000/),
    ).toBeInTheDocument();
    expect(calls[1]?.request.eventId).toBe('event-b');
  });

  it('shows an error with a way to try again', async () => {
    const failing: AssistantProvider = {
      info: { id: 'broken', label: 'Guided planner' },
      examples: [],
      respond: () => Promise.reject(new Error('boom')),
    };
    const storage = renderAssistant([budgeted()], failing);
    await say('Explain my budget');
    expect(
      await within(log()).findByText(
        'Guided planner could not answer. Nothing was changed.',
      ),
    ).toBeInTheDocument();
    expect(within(log()).getByRole('button', { name: 'Ask again' })).toBeInTheDocument();
    expect(saved(storage).profile.revision).toBe(1);
  });

  it('rejects an empty message without sending', async () => {
    renderAssistant();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      screen.getByText('Type a message or choose one of the examples.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Messages' })).toBeNull();
  });
});
