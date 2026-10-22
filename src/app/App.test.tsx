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

function renderApp({ storage = new MemoryStorage(), path = '/' }: Options = {}) {
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
const follow = (name: string | RegExp) =>
  userEvent.click(screen.getByRole('link', { name }));
const h1 = (name: string | RegExp) => screen.getByRole('heading', { level: 1, name });

/** Creates a demonstration through the New event page and lands on its Overview. */
async function createDemo(label: 'Wedding' | 'Birthday' | 'Outdoor community event') {
  if (!screen.queryByRole('heading', { level: 1, name: 'New event' })) {
    const [link] = screen.getAllByRole('link', { name: /New event|Create an event/ });
    if (!link) throw new Error('no link to the New event page');
    await userEvent.click(link);
  }
  await click(`Create demo: ${label}`);
}

function savedState(storage: MemoryStorage) {
  const raw = storage.data.get(SAVED_STATE_KEY);
  if (raw === undefined) return null;
  return savedEnvelopeSchema.parse(JSON.parse(raw)).data;
}

describe('the shell', () => {
  it('has the main landmarks, a skip link, and a labelled navigation to every section', () => {
    renderApp();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const name of [
      'Overview',
      'Budget',
      'Timeline',
      'Vendors',
      'Assistant',
      'Ideas',
    ]) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(`^${name}`) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Your data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
    // Guest planning lives inside event details, not in the top-level navigation.
    expect(within(nav).queryByRole('link', { name: /guests/i })).not.toBeInTheDocument();
  });

  it('the skip link moves focus to the main content without changing the page', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(h1('Welcome')).toBeInTheDocument();
  });

  it('marks unfinished sections in the navigation instead of hiding that they are unfinished', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /^Ideas\s*Soon/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Budget' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });

  it('moves focus to the new page heading and names the tab after navigating', async () => {
    renderApp();
    await follow(/^Budget/);
    expect(h1('Budget')).toHaveFocus();
    expect(document.title).toBe('Budget · Celebration Planner');
    expect(screen.getByRole('link', { name: /^Budget/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('shows a page, not a blank screen, for an unknown address', async () => {
    renderApp({ path: '/nope/at/all' });
    expect(h1('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    await follow('Go to Overview');
    expect(h1('Welcome')).toBeInTheDocument();
  });

  it('keeps the old events address working', () => {
    renderApp({ path: '/events' });
    expect(h1('Welcome')).toBeInTheDocument();
  });
});

describe('the compact menu', () => {
  it('opens and closes with a labelled button and closes when a link is chosen', async () => {
    renderApp();
    const button = screen.getByRole('button', { name: 'Menu' });
    const panel = document.getElementById('app-menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'app-menu');
    expect(panel).toHaveAttribute('data-open', 'false');

    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(panel).toHaveAttribute('data-open', 'true');

    await follow(/^Timeline/);
    expect(h1('Timeline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(panel).toHaveAttribute('data-open', 'false');
  });

  it('closes with Escape and returns focus to the button', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.tab(); // into the panel
    await userEvent.keyboard('{Escape}');
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('closes the menu and moves focus to the heading after choosing an event', async () => {
    renderApp();
    await createDemo('Wedding');
    await createDemo('Birthday');
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(document.getElementById('app-menu')).toHaveAttribute('data-open', 'true');

    await userEvent.selectOptions(
      screen.getByLabelText('Active event'),
      'Demo wedding (fictional)',
    );
    expect(document.getElementById('app-menu')).toHaveAttribute('data-open', 'false');
    await vi.waitFor(() => {
      expect(h1('Demo wedding (fictional)')).toHaveFocus();
    });
  });

  it('leaves focus on the select when the menu is not open (wide screens)', async () => {
    renderApp();
    await createDemo('Wedding');
    await createDemo('Birthday');
    const select = screen.getByLabelText('Active event');
    await userEvent.selectOptions(select, 'Demo wedding (fictional)');
    expect(h1('Demo wedding (fictional)')).not.toHaveFocus();
    expect(select).toHaveFocus();
  });

  it('shows the active event title in the bar, and switches events', async () => {
    renderApp();
    await createDemo('Wedding');
    await createDemo('Birthday');
    const bar = screen.getByRole('banner');
    expect(
      within(bar).getByText(/Demo birthday party \(fictional\)/),
    ).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText('Active event'),
      'Demo wedding (fictional)',
    );
    expect(within(bar).getByText(/Demo wedding \(fictional\)/)).toBeInTheDocument();
    expect(h1('Demo wedding (fictional)')).toBeInTheDocument();
    expect(document.title).toBe('Demo wedding (fictional) · Celebration Planner');
  });
});

describe('events: create, switch, restore', () => {
  it('starts empty with a welcome and no storage warning', () => {
    renderApp();
    expect(h1('Welcome')).toBeInTheDocument();
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an event' })).toHaveAttribute(
      'href',
      '/new',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('creates a labelled demo whose date comes from the injected calendar', async () => {
    const storage = new MemoryStorage();
    renderApp({ storage });
    await createDemo('Wedding');

    expect(h1('Demo wedding (fictional)')).toBeInTheDocument();
    expect(h1('Demo wedding (fictional)')).toHaveFocus();
    expect(screen.getByText(/Created “Demo wedding \(fictional\)”/)).toBeInTheDocument();
    expect(screen.getAllByText(/19 January 2027/).length).toBeGreaterThan(0); // 2026-10-21 + 90 days
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('₹5,00,000')).toBeInTheDocument();
    expect(savedState(storage)?.events).toHaveLength(1);
  });

  it('shows the creation notice once, for the event it is about only', async () => {
    renderApp();
    await createDemo('Wedding');
    expect(screen.getByText(/Created “Demo wedding \(fictional\)”/)).toBeInTheDocument();
    await createDemo('Birthday');
    expect(
      screen.getByText(/Created “Demo birthday party \(fictional\)”/),
    ).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText('Active event'),
      'Demo wedding (fictional)',
    );
    expect(h1('Demo wedding (fictional)')).toBeInTheDocument();
    expect(screen.queryByText(/Created “/)).not.toBeInTheDocument();

    await follow(/^Budget/);
    await follow('Overview');
    expect(screen.queryByText(/Created “/)).not.toBeInTheDocument();
  });

  it('keeps several events and restores them and the active selection after a reload', async () => {
    const storage = new MemoryStorage();
    const first = renderApp({ storage });
    await createDemo('Wedding');
    await createDemo('Outdoor community event');
    await userEvent.selectOptions(
      screen.getByLabelText('Active event'),
      'Demo wedding (fictional)',
    );
    first.unmount();

    renderApp({ storage });
    expect(h1('Demo wedding (fictional)')).toBeInTheDocument();
    const options = within(screen.getByLabelText('Active event')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Demo wedding (fictional)',
      'Demo community event (fictional)',
    ]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('creates an event from the form and rejects blank input without defaulting to zero', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    renderApp({ storage, path: '/new' });
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

    expect(h1('Club anniversary')).toBeInTheDocument();
    expect(savedState(storage)?.events[0]?.profile).toMatchObject({
      guestCount: 75,
      budgetPaise: 12_500_050,
      revision: 0,
    });
  });

  it('rejects a past date for a new event but accepts today', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/new' });
    await user.type(screen.getByLabelText(/Title/), 'Late party');
    await user.selectOptions(screen.getByLabelText(/Event type/), 'community');
    await user.type(screen.getByLabelText(/City/), 'Pune');
    await user.type(screen.getByLabelText(/Expected guests/), '20');
    await user.type(screen.getByLabelText(/Budget/), '5000');
    await user.selectOptions(screen.getByLabelText(/Setting/), 'indoor');

    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-20' } });
    await click('Create event');
    expect(
      screen.getByText('Choose today or a later date for a new event'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-21' } });
    await click('Create event');
    expect(h1('Late party')).toBeInTheDocument();
  });

  it('edits the active event, announcing the result and increasing its revision', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    renderApp({ storage });
    await createDemo('Birthday');
    await click('Edit event');
    await user.clear(screen.getByLabelText(/Expected guests/));
    await user.type(screen.getByLabelText(/Expected guests/), '55');
    await click('Save changes');

    expect(screen.getByText('Saved your changes.')).toBeInTheDocument();
    expect(savedState(storage)?.events[0]?.profile).toMatchObject({
      guestCount: 55,
      revision: 1,
    });
  });

  it('asks before deleting, with focus kept safe, and deletes only when confirmed', async () => {
    const storage = new MemoryStorage();
    renderApp({ storage });
    await createDemo('Wedding');

    const trigger = screen.getByRole('button', {
      name: 'Delete Demo wedding (fictional)',
    });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Delete this event?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(dialog).toHaveTextContent('This cannot be undone');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(savedState(storage)?.events).toHaveLength(1);

    await userEvent.click(trigger);
    await click('Yes, delete this event');
    expect(h1('Welcome')).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(h1('Welcome')).toHaveFocus();
    });
    expect(savedState(storage)?.events).toEqual([]);
  });
});

describe('guest planning inside the event', () => {
  it('counts only the guests actually entered, and validates input', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    renderApp({ storage });
    await createDemo('Birthday'); // 40 expected guests

    const guests = screen.getByRole('region', { name: 'Guests' });
    const counts = () =>
      Object.fromEntries(
        within(guests)
          .getAllByRole('term')
          .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
      );
    expect(counts()).toMatchObject({
      'Expected guests': '40',
      'People listed': '0',
      Accepted: '0',
      Declined: '0',
      'No reply yet': '0',
    });
    expect(within(guests).getByText('No guests listed yet.')).toBeInTheDocument();

    await userEvent.click(within(guests).getByRole('button', { name: 'Add guest' }));
    expect(within(guests).getByText('Guest name is required')).toBeInTheDocument();
    expect(within(guests).getByLabelText('Name or alias')).toHaveFocus();

    await user.type(within(guests).getByLabelText('Name or alias'), 'Rao family');
    await user.clear(within(guests).getByLabelText('Group size'));
    await user.type(within(guests).getByLabelText('Group size'), '0');
    await userEvent.click(within(guests).getByRole('button', { name: 'Add guest' }));
    expect(within(guests).getByText('Party size must be at least 1')).toBeInTheDocument();

    await user.clear(within(guests).getByLabelText('Group size'));
    await user.type(within(guests).getByLabelText('Group size'), '4');
    await userEvent.click(within(guests).getByRole('button', { name: 'Add guest' }));
    expect(within(guests).getByText('Added Rao family.')).toBeInTheDocument();
    expect(counts()).toMatchObject({ 'People listed': '4', 'No reply yet': '4' });
    expect(savedState(storage)?.events[0]?.guests).toHaveLength(1);

    await user.selectOptions(
      within(guests).getByLabelText('Reply from Rao family'),
      'accepted',
    );
    expect(counts()).toMatchObject({ Accepted: '4', 'No reply yet': '0' });

    await userEvent.click(
      within(guests).getByRole('button', { name: 'Remove Rao family' }),
    );
    expect(counts()).toMatchObject({ 'People listed': '0' });
    expect(within(guests).getByText('Removed Rao family.')).toBeInTheDocument();
    expect(savedState(storage)?.events[0]?.guests).toEqual([]);
  });

  it('says so when more people are listed than expected', async () => {
    const user = userEvent.setup();
    renderApp();
    await createDemo('Birthday');
    const guests = screen.getByRole('region', { name: 'Guests' });
    for (const [name, size] of [
      ['Big group', '20'],
      ['Another group', '20'],
      ['Third group', '1'],
    ] as const) {
      await user.type(within(guests).getByLabelText('Name or alias'), name);
      await user.clear(within(guests).getByLabelText('Group size'));
      await user.type(within(guests).getByLabelText('Group size'), size);
      await userEvent.click(within(guests).getByRole('button', { name: 'Add guest' }));
    }
    expect(
      within(guests).getByText(/more people than the expected 40/),
    ).toBeInTheDocument();
  });
});

describe('sections that are not built yet', () => {
  it('shows only real figures from the event and says plainly what is missing', async () => {
    renderApp();
    await createDemo('Wedding');

    await follow(/^Ideas/);
    expect(screen.getByText('Ideas saved').nextElementSibling).toHaveTextContent('0');
    await follow(/^Assistant/);
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(screen.getByText('Not built yet')).toBeInTheDocument();
  });

  it('does not invent totals when there is no event', () => {
    renderApp({ path: '/budget' });
    expect(h1('Budget')).toBeInTheDocument();
    expect(screen.getByText('No event selected')).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an event' })).toHaveAttribute(
      'href',
      '/new',
    );
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

    await createDemo('Wedding');
    expect(h1('Demo wedding (fictional)')).toBeInTheDocument();
    expect(storage.data.get(SAVED_STATE_KEY)).toBe('{definitely not json');
    expect(storage.setItemCalls).toBe(0);

    await click('Download saved data');
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe('{definitely not json');

    await click('Clear saved data');
    const dialog = screen.getByRole('dialog', { name: 'Clear saved data' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(true);

    await click('Clear saved data');
    await click('Yes, clear saved data');
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(false);
    expect(storage.data.get('some-other-app:key')).toBe('keep me');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByText('Saved data cleared. You can start again.'),
    ).toBeInTheDocument();
    expect(h1('Welcome')).toBeInTheDocument();

    await createDemo('Birthday');
    expect(savedState(storage)?.events).toHaveLength(1);
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
    await createDemo('Birthday');
    expect(storage.data.get(SAVED_STATE_KEY)).toBe('garbage');
  });

  it('explains data from a newer version and does not touch it', async () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 7, data: {} });
    storage.data.set(SAVED_STATE_KEY, raw);
    renderApp({ storage });
    expect(screen.getByText('Saved data is from a newer version')).toBeInTheDocument();
    await createDemo('Wedding');
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
    await createDemo('Wedding');
    expect(h1('Demo wedding (fictional)')).toBeInTheDocument();
  });

  it('reports a full storage quota and recovers when the user retries', async () => {
    const storage = new MemoryStorage();
    renderApp({ storage });
    storage.failWrites = 'quota';
    await createDemo('Wedding');

    const alert = screen.getByRole('alert');
    expect(
      within(alert).getByText('Your latest changes were not saved'),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/storage is full/i)).toBeInTheDocument();
    expect(h1('Demo wedding (fictional)')).toBeInTheDocument();

    storage.failWrites = 'none';
    await click('Try saving again');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(savedState(storage)?.events).toHaveLength(1);
  });
});

describe('data page', () => {
  it('states plainly where data lives and that it is not an account or encrypted', () => {
    renderApp({ path: '/data' });
    expect(h1('Your data')).toBeInTheDocument();
    expect(screen.getByText(/not encrypted/)).toBeInTheDocument();
    expect(screen.getByText(/no account/)).toBeInTheDocument();
    expect(screen.getByText(/chat is not saved/i)).toBeInTheDocument();
    expect(screen.getByText('Saving on')).toBeInTheDocument();
  });

  it('clears saved data after confirmation without touching other sites’ keys', async () => {
    const storage = new MemoryStorage();
    storage.data.set('some-other-app:key', 'keep me');
    renderApp({ storage });
    await createDemo('Wedding');
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(true);

    await follow('Your data');
    await click('Clear saved data');
    await click('Yes, clear saved data');
    expect(screen.getByText('Saved data cleared.')).toBeInTheDocument();
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(false);
    expect(storage.data.get('some-other-app:key')).toBe('keep me');

    await follow('Overview');
    expect(h1('Welcome')).toBeInTheDocument();
  });
});
