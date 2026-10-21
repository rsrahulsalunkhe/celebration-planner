import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedEnvelopeSchema } from '@/domain/schemas.ts';
import { SAVED_STATE_KEY, type StorageLike } from '@/services/storage.ts';
import { MemoryStorage, fixedCalendar } from '@/test/helpers.ts';
import { AppRoutes } from './AppRoutes.tsx';
import { CalendarContext } from './state/plannerContext.ts';
import { PlannerProvider } from './state/PlannerProvider.tsx';

interface Options {
  storage?: StorageLike | null;
  path?: string;
}

function renderApp({ storage = new MemoryStorage(), path = '/events' }: Options = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CalendarContext value={fixedCalendar('2026-10-21')}>
        <PlannerProvider storage={storage}>
          <AppRoutes />
        </PlannerProvider>
      </CalendarContext>
    </MemoryRouter>,
  );
}

const click = (name: string | RegExp) =>
  userEvent.click(screen.getByRole('button', { name }));

function savedEvents(storage: MemoryStorage) {
  const raw = storage.data.get(SAVED_STATE_KEY);
  if (raw === undefined) return null;
  const parsed = savedEnvelopeSchema.parse(JSON.parse(raw));
  return parsed.data;
}

describe('events: create, switch, restore', () => {
  it('starts empty with no storage warning', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(screen.getByText('No events yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('creates a labelled demo whose date comes from the injected calendar', async () => {
    const storage = new MemoryStorage();
    renderApp({ storage });
    await click('Create demo: Wedding');

    const heading = screen.getByRole('heading', {
      level: 2,
      name: /Active event: Demo wedding/,
    });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('19 January 2027')).toBeInTheDocument(); // 2026-10-21 + 90 days
    expect(screen.getAllByText('₹5,00,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fictional demonstration input/).length).toBeGreaterThan(
      0,
    );
    expect(savedEvents(storage)?.events).toHaveLength(1);
  });

  it('keeps several events, switches the active one, and deletes after confirmation', async () => {
    renderApp();
    await click('Create demo: Wedding');
    await click('Create demo: Birthday');
    expect(
      screen.getByRole('heading', { level: 2, name: /Active event: Demo birthday/ }),
    ).toBeInTheDocument();

    await click('Switch to this event: Demo wedding (fictional)');
    expect(
      screen.getByRole('heading', { level: 2, name: /Active event: Demo wedding/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your events (2)' }),
    ).toBeInTheDocument();

    await click('Delete Demo wedding (fictional)');
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    await click('Cancel');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your events (2)' }),
    ).toBeInTheDocument();

    await click('Delete Demo wedding (fictional)');
    await click('Yes, delete this event');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your events (1)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Active event: Demo birthday/ }),
    ).toBeInTheDocument();
  });

  it('restores events and the active selection after a reload', async () => {
    const storage = new MemoryStorage();
    const first = renderApp({ storage });
    await click('Create demo: Wedding');
    await click('Create demo: Outdoor community event');
    await click('Switch to this event: Demo wedding (fictional)');
    first.unmount();

    renderApp({ storage });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your events (2)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Active event: Demo wedding/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('creates an event from the form and rejects blank input without defaulting to zero', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    renderApp({ storage });
    await click('New event');
    await click('Create event');

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/Please fix 7 problems/)).toBeInTheDocument();
    expect(
      within(alert).getByText(/Enter the total budget in rupees/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveFocus();
    expect(storage.data.size).toBe(0);

    await user.type(screen.getByLabelText(/Title/), 'Club anniversary');
    await user.selectOptions(screen.getByLabelText(/Event type/), 'community');
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2027-03-10' } });
    await user.type(screen.getByLabelText(/City/), 'Pune');
    await user.type(screen.getByLabelText(/Expected guests/), '2.5');
    await user.type(screen.getByLabelText(/Budget/), '0');
    await user.selectOptions(screen.getByLabelText(/Setting/), 'outdoor');
    await click('Create event');
    expect(screen.getByText('Enter a whole number, like 150')).toBeInTheDocument();
    expect(screen.getByText('Budget must be greater than zero')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Expected guests/));
    await user.type(screen.getByLabelText(/Expected guests/), '75');
    await user.clear(screen.getByLabelText(/Budget/));
    await user.type(screen.getByLabelText(/Budget/), '1,25,000.50');
    await click('Create event');

    expect(
      screen.getByRole('heading', { level: 2, name: 'Active event: Club anniversary' }),
    ).toBeInTheDocument();
    expect(savedEvents(storage)?.events[0]?.profile).toMatchObject({
      guestCount: 75,
      budgetPaise: 12_500_050,
      revision: 0,
    });
  });

  it('edits the active event, increasing its revision', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    renderApp({ storage });
    await click('Create demo: Birthday');
    await click('Edit event');
    await user.clear(screen.getByLabelText(/Expected guests/));
    await user.type(screen.getByLabelText(/Expected guests/), '55');
    await click('Save changes');

    expect(screen.getByText('Saved your changes.')).toBeInTheDocument();
    expect(savedEvents(storage)?.events[0]?.profile).toMatchObject({
      guestCount: 55,
      revision: 1,
    });
  });
});

describe('recovery from invalid or unavailable storage', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:test');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('protects corrupt data, lets the user keep working, offers a copy, and clears only this app’s keys', async () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, '{definitely not json');
    storage.data.set('some-other-app:key', 'keep me');
    renderApp({ storage });

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Saved data could not be read')).toBeInTheDocument();

    // The app stays usable in memory, but the unreadable data is not overwritten.
    await click('Create demo: Wedding');
    expect(
      screen.getByRole('heading', { level: 2, name: /Active event: Demo wedding/ }),
    ).toBeInTheDocument();
    expect(storage.data.get(SAVED_STATE_KEY)).toBe('{definitely not json');
    expect(storage.setItemCalls).toBe(0);

    // Recovery copy.
    await click('Download saved data');
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe('{definitely not json');

    // Clearing needs confirmation; cancelling changes nothing.
    await click('Clear saved data');
    await click('Cancel');
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(true);

    await click('Clear saved data');
    await click('Yes, clear saved data');
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(false);
    expect(storage.data.get('some-other-app:key')).toBe('keep me');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No events yet')).toBeInTheDocument();
    expect(
      screen.getByText('Saved data cleared. You can start again.'),
    ).toBeInTheDocument();

    // Saving works again afterwards.
    await click('Create demo: Birthday');
    expect(savedEvents(storage)?.events).toHaveLength(1);
  });

  it('keeps a compact warning after the notice is dismissed, and still never overwrites', async () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, 'garbage');
    renderApp({ storage });
    await click('Keep working');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByText('Saving is paused because saved data could not be read.'),
    ).toBeInTheDocument();
    await click('Create demo: Birthday');
    expect(storage.data.get(SAVED_STATE_KEY)).toBe('garbage');
  });

  it('explains data from a newer version and does not touch it', async () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 7, data: {} });
    storage.data.set(SAVED_STATE_KEY, raw);
    renderApp({ storage });
    expect(screen.getByText('Saved data is from a newer version')).toBeInTheDocument();
    await click('Create demo: Wedding');
    expect(storage.data.get(SAVED_STATE_KEY)).toBe(raw);
  });

  it('works in memory with an actionable notice when storage is unavailable', async () => {
    renderApp({ storage: null });
    const alert = screen.getByRole('alert');
    expect(
      within(alert).getByText('This browser is not allowing saving'),
    ).toBeInTheDocument();
    expect(
      within(alert).getByRole('button', { name: /Export all events/ }),
    ).toBeInTheDocument();
    await click('Create demo: Wedding');
    expect(
      screen.getByRole('heading', { level: 2, name: /Active event: Demo wedding/ }),
    ).toBeInTheDocument();
  });

  it('reports a full storage quota and recovers when the user retries', async () => {
    const storage = new MemoryStorage();
    renderApp({ storage });
    storage.failWrites = 'quota';
    await click('Create demo: Wedding');

    const alert = screen.getByRole('alert');
    expect(
      within(alert).getByText('Your latest changes were not saved'),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/storage is full/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Active event: Demo wedding/ }),
    ).toBeInTheDocument();

    storage.failWrites = 'none';
    await click('Try saving again');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(savedEvents(storage)?.events).toHaveLength(1);
  });
});

describe('data page', () => {
  it('states plainly where data lives and that it is not an account or encrypted', () => {
    renderApp({ path: '/data' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your data' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not encrypted/)).toBeInTheDocument();
    expect(screen.getByText(/no account/)).toBeInTheDocument();
    expect(screen.getByText(/chat is not saved/i)).toBeInTheDocument();
  });

  it('clears saved data after confirmation without touching other sites’ keys', async () => {
    const storage = new MemoryStorage();
    storage.data.set('some-other-app:key', 'keep me');
    renderApp({ storage, path: '/events' });
    await click('Create demo: Wedding');
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(true);

    await userEvent.click(screen.getByRole('link', { name: 'Data' }));
    await click('Clear saved data');
    await click('Yes, clear saved data');
    expect(screen.getByText('Saved data cleared.')).toBeInTheDocument();
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(false);
    expect(storage.data.get('some-other-app:key')).toBe('keep me');

    await userEvent.click(screen.getByRole('link', { name: 'Events' }));
    expect(screen.getByText('No events yet')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('redirects the root to Events and marks the current section', async () => {
    renderApp({ path: '/' });
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Budget' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows a not-found page for unknown routes', () => {
    renderApp({ path: '/nope' });
    expect(screen.getByText('That page does not exist')).toBeInTheDocument();
  });
});
