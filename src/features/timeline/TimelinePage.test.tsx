import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '@/app/AppRoutes.tsx';
import { CalendarContext } from '@/app/state/plannerContext.ts';
import { PlannerProvider } from '@/app/state/PlannerProvider.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { addDays } from '@/domain/dates.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { startingTimelineOperations } from '@/domain/planning/timeline.ts';
import { savedEnvelopeSchema } from '@/domain/schemas.ts';
import type { EventRecord } from '@/domain/types.ts';
import { SAVED_STATE_KEY, serializeSavedState } from '@/services/storage.ts';
import {
  MemoryStorage,
  TODAY,
  fixedCalendar,
  presetEvent,
  withProfile,
} from '@/test/helpers.ts';

function planned(id: 'wedding' | 'birthday' | 'community' = 'wedding'): EventRecord {
  const record = presetEvent(id);
  const next = applyOperations(
    record,
    startingTimelineOperations(record, PLANNING_CONFIGURATION, TODAY),
  );
  if (!next) throw new Error('fixture');
  return next;
}

function renderAt(path: string, record: EventRecord) {
  const storage = new MemoryStorage();
  storage.data.set(
    SAVED_STATE_KEY,
    serializeSavedState({ activeEventId: record.profile.id, events: [record] }),
  );
  render(
    <MemoryRouter initialEntries={[path]}>
      <CalendarContext value={fixedCalendar(TODAY)}>
        <PlannerProvider storage={storage}>
          <AppRoutes />
        </PlannerProvider>
      </CalendarContext>
    </MemoryRouter>,
  );
  return storage;
}

function saved(storage: MemoryStorage): EventRecord {
  const raw = storage.data.get(SAVED_STATE_KEY);
  if (raw === undefined) throw new Error('nothing saved');
  const event = savedEnvelopeSchema.parse(JSON.parse(raw)).data.events[0];
  if (!event) throw new Error('no event');
  return event;
}

const status = () =>
  screen
    .getAllByRole('status')
    .map((s) => s.textContent)
    .join(' ');
const taskItem = (title: string) => {
  const heading = screen.getByRole('heading', { level: 3, name: title });
  const li = heading.closest('li');
  if (!li) throw new Error('no item');
  return li;
};

describe('the timeline workspace', () => {
  it('creates a timeline and groups it by phase, keeping the three kinds distinct', async () => {
    const storage = renderAt('/timeline', presetEvent('community'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Create timeline from the plan' }),
    );
    expect(status()).toMatch(/Created \d+ planned steps/);
    for (const name of [
      'The final month',
      'The final week',
      'On the event day',
      'After the event',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    const day = screen.getByRole('region', { name: 'On the event day' });
    expect(
      within(day).getByText('Clear the site, sort waste and pack hired equipment'),
    ).toBeInTheDocument();
    expect(within(day).getAllByText('Event day').length).toBeGreaterThan(0);
    const after = screen.getByRole('region', { name: 'After the event' });
    expect(within(after).getAllByText('Follow-up').length).toBeGreaterThan(0);
    expect(saved(storage).budgetCategories).toEqual([]);
  });

  it('shows blockers and does not complete prerequisites when a task is marked done', async () => {
    const storage = renderAt('/timeline', planned('wedding'));
    const venue = taskItem('Shortlist and book the venue');
    expect(
      within(venue)
        .getByText(/Waiting for:/)
        .closest('p'),
    ).toHaveTextContent('Confirm the total budget and reserve; Draft the guest list');
    await userEvent.click(
      within(venue).getByRole('button', {
        name: 'Mark done: Shortlist and book the venue',
      }),
    );
    expect(status()).toMatch(/prerequisites .* are still open and were not changed/);
    const tasks = saved(storage).tasks;
    expect(tasks.find((t) => t.templateId === 'task.book-venue')?.status).toBe('done');
    expect(tasks.find((t) => t.templateId === 'task.set-budget')?.status).toBe('todo');
  });

  it('adds a custom task with an owner, and filters by owner, status and urgency', async () => {
    const storage = renderAt('/timeline', planned('birthday'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await user.type(screen.getByLabelText(/^Task/), 'Borrow extra chairs');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByText('Enter a deadline')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Deadline/), {
      target: { value: addDays(TODAY, 30) },
    });
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(
      screen.getByText(/Preparation must be due on or before the event/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Deadline/), {
      target: { value: addDays(TODAY, 3) },
    });
    await user.type(screen.getByLabelText(/^Organizer or volunteer/), 'Priya');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(status()).toMatch(/Added “Borrow extra chairs”/);

    const custom = saved(storage).tasks.find((t) => t.title === 'Borrow extra chairs');
    expect(custom).toMatchObject({
      owner: 'Priya',
      dueDateOrigin: 'user',
      kind: 'preparation',
    });
    expect(custom?.templateId).toBeUndefined();
    expect(
      within(taskItem('Borrow extra chairs')).getByText('Your task'),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Owner'), 'Priya');
    expect(screen.getByText('Showing 1 of', { exact: false })).toHaveTextContent(
      'Showing 1 of',
    );
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'done');
    expect(screen.getByText('No tasks match these filters.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.selectOptions(screen.getByLabelText('Urgency'), 'blocked');
    expect(
      screen.queryByRole('heading', { level: 3, name: 'Borrow extra chairs' }),
    ).toBeNull();
  });

  it('edits notes and a deadline; a manual deadline is marked as yours', async () => {
    const storage = renderAt('/timeline', planned('wedding'));
    const user = userEvent.setup();
    const attire = taskItem('Arrange outfits and fittings');
    await user.click(
      within(attire).getByRole('button', { name: 'Edit “Arrange outfits and fittings”' }),
    );
    const deadline = within(attire).getByLabelText(/^Deadline/);
    expect(deadline).toHaveFocus();
    fireEvent.change(deadline, { target: { value: addDays(TODAY, 45) } });
    await user.type(within(attire).getByLabelText('Notes'), 'Second fitting booked');
    await user.click(within(attire).getByRole('button', { name: 'Save task' }));
    expect(status()).toMatch(/The new deadline is yours/);
    const task = saved(storage).tasks.find((t) => t.templateId === 'task.attire');
    expect(task).toMatchObject({
      dueDate: addDays(TODAY, 45),
      dueDateOrigin: 'user',
      dueDateSetFor: addDays(TODAY, 90),
      notes: 'Second fitting booked',
    });
    expect(
      within(taskItem('Arrange outfits and fittings')).getByText(/deadline set by you/),
    ).toBeInTheDocument();
  });
});

describe('moving the event from 90 days to five days ahead', () => {
  it('recalculates deadlines, keeps completed work and flags manual deadlines for review', async () => {
    let record = planned('wedding');
    const done = record.tasks.find((t) => t.templateId === 'task.set-budget');
    const attire = record.tasks.find((t) => t.templateId === 'task.attire');
    if (!done || !attire) throw new Error('fixture');
    const next = applyOperations(record, [
      { op: 'tasks/upsert', item: { ...done, status: 'done' } },
      {
        op: 'tasks/upsert',
        item: {
          ...attire,
          dueDate: addDays(TODAY, 40),
          dueDateOrigin: 'user',
          dueDateSetFor: record.profile.date,
        },
      },
    ]);
    if (!next) throw new Error('fixture');
    record = next;
    const storage = renderAt('/', record);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    fireEvent.change(screen.getByLabelText(/^Date/), {
      target: { value: addDays(TODAY, 5) },
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(status()).toMatch(
      /planned deadlines were recalculated\. 1 deadline you set needs review/,
    );

    const after = saved(storage);
    expect(after.tasks.find((t) => t.id === done.id)).toMatchObject({
      status: 'done',
      dueDate: done.dueDate,
    });
    expect(after.tasks.find((t) => t.id === attire.id)?.dueDate).toBe(addDays(TODAY, 40));

    await user.click(screen.getByRole('link', { name: 'Timeline' }));
    expect(
      screen.getByText(
        /Moving every deadline to today would not make this schedule feasible/,
      ),
    ).toBeInTheDocument();
    const venue = taskItem('Shortlist and book the venue');
    expect(within(venue).getByText(/Usual deadline:/)).toBeInTheDocument();
    expect(within(venue).getByText(/Catch up now/)).toBeInTheDocument();

    const review = screen.getByRole('region', { name: 'Deadlines to review' });
    await user.click(
      within(review).getByRole('button', { name: /Use the planned deadline/ }),
    );
    expect(saved(storage).tasks.find((t) => t.id === attire.id)).toMatchObject({
      dueDateOrigin: 'generated',
    });
    expect(screen.queryByRole('region', { name: 'Deadlines to review' })).toBeNull();
  });
});

describe('same-day and past events', () => {
  it('a past event still opens and can be worked on', async () => {
    const past = withProfile(planned('community'), { date: addDays(TODAY, -2) });
    const storage = renderAt('/timeline', past);
    expect(screen.getByText(/kept as history/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Mark done: Thank the volunteers' }),
    );
    expect(
      saved(storage).tasks.find((t) => t.templateId === 'task.thank-volunteers')?.status,
    ).toBe('done');
  });

  it('a same-day event shows what is left for today', () => {
    renderAt('/timeline', withProfile(planned('birthday'), { date: TODAY }));
    expect(screen.getByText(/The event is today/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'On the event day' }),
    ).toBeInTheDocument();
  });
});

describe('event-day running order', () => {
  it('adds items with local times, rejects an end before the start and flags overlaps', async () => {
    const storage = renderAt('/timeline', planned('birthday'));
    const user = userEvent.setup();
    const card = screen.getByRole('region', { name: 'Event-day running order' });

    const add = async (title: string, start: string, end: string) => {
      await user.click(within(card).getByRole('button', { name: 'Add item' }));
      await user.type(within(card).getByLabelText(/^Item/), title);
      fireEvent.change(within(card).getByLabelText(/^Starts/), {
        target: { value: start },
      });
      fireEvent.change(within(card).getByLabelText(/^Ends/), { target: { value: end } });
      await user.click(
        within(card).getByRole('button', { name: 'Add to running order' }),
      );
    };

    await add('Cake', '19:00', '18:30');
    expect(
      within(card).getByText('The end time must be after the start time'),
    ).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText(/^Ends/), {
      target: { value: '19:20' },
    });
    await user.click(within(card).getByRole('button', { name: 'Add to running order' }));
    await add('Games', '18:00', '19:10');

    const rows = within(card).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      '18:00–19:10',
      '19:00–19:20',
    ]);
    expect(within(card).getByText(/overlap by 10 min/)).toBeInTheDocument();
    expect(
      saved(storage)
        .runOrder.map((i) => i.title)
        .sort(),
    ).toEqual(['Cake', 'Games']);

    // Editing uses a form, not dragging: moving Games later reorders the list.
    await user.click(within(card).getByRole('button', { name: 'Edit Games' }));
    fireEvent.change(within(card).getByLabelText(/^Starts/), {
      target: { value: '19:30' },
    });
    fireEvent.change(within(card).getByLabelText(/^Ends/), {
      target: { value: '20:00' },
    });
    await user.click(within(card).getByRole('button', { name: 'Save item' }));
    expect(within(card).queryByText(/overlap/)).toBeNull();
    const [first] = within(card).getAllByRole('row').slice(1);
    if (!first) throw new Error('no rows');
    expect(within(first).getByRole('rowheader')).toHaveTextContent('Cake');
  });
});
