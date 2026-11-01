import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '@/app/AppRoutes.tsx';
import { CalendarContext } from '@/app/state/plannerContext.ts';
import { PlannerProvider } from '@/app/state/PlannerProvider.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { buildLedger, startingBudgetOperations } from '@/domain/planning/budget.ts';
import { depositPaymentId } from '@/domain/planning/vendors.ts';
import { savedEnvelopeSchema } from '@/domain/schemas.ts';
import type { EventRecord } from '@/domain/types.ts';
import { SAVED_STATE_KEY, serializeSavedState } from '@/services/storage.ts';
import { MemoryStorage, TODAY, fixedCalendar, presetEvent } from '@/test/helpers.ts';

function budgeted(id: 'wedding' | 'birthday' | 'community'): EventRecord {
  const record = presetEvent(id);
  const next = applyOperations(
    record,
    startingBudgetOperations(record, PLANNING_CONFIGURATION, TODAY),
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
const result = (name: string) => {
  const heading = screen.getByRole('heading', { level: 4, name });
  const li = heading.closest('li');
  if (!li) throw new Error('no result');
  return li;
};

describe('vendor matching on the page', () => {
  it('labels sample data and shows how accessibility needs affect matches', () => {
    renderAt('/vendors', presetEvent('community')); // Satara, wheelchair access, outdoor
    expect(
      screen.getByText(/Sample data: fictional vendors with illustrative prices/),
    ).toBeInTheDocument();
    const needs = screen.getByRole('region', { name: 'What vendors must meet' });
    expect(
      within(needs).getByText(
        /Venue: Wheelchair access \(you listed this accessibility need\)/,
      ),
    ).toBeInTheDocument();

    const hall = result('Sahyadri Community Hall');
    expect(within(hall).getByText('Sample data')).toBeInTheDocument();
    expect(within(hall).getByText(/^Ranked 1 among venue options/)).toBeInTheDocument();

    const lawns = result('Riverside Lawns');
    expect(within(lawns).getByText('Not suitable')).toBeInTheDocument();
    expect(
      within(lawns).getByText(/^Excluded: .*Covered or indoor alternative/),
    ).toBeInTheDocument();
  });

  it('shows unknown capabilities as Needs confirmation', () => {
    const wedding = presetEvent('wedding');
    renderAt('/vendors', {
      ...wedding,
      preferences: { ...wedding.preferences, accessibilityNeeds: ['wheelchair-access'] },
    });
    const confirm = screen.getByRole('region', { name: 'Needs confirmation' });
    const lawns = within(confirm).getByRole('heading', {
      level: 4,
      name: 'Riverside Lawns',
    });
    expect(lawns).toBeInTheDocument();
    expect(
      within(confirm).getAllByText(/Wheelchair access: not known/).length,
    ).toBeGreaterThan(0);
  });

  it('searches and filters by category', async () => {
    renderAt('/vendors', presetEvent('wedding'));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Category'), 'catering');
    expect(
      screen.queryByRole('heading', { level: 4, name: 'Lotus Courtyard Hall' }),
    ).toBeNull();
    expect(
      screen.getByRole('heading', { level: 4, name: 'Annapurna Kitchen' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Search/), 'halal');
    expect(
      screen.getByRole('heading', { level: 4, name: 'Spice Route Caterers' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 4, name: 'Annapurna Kitchen' }),
    ).toBeNull();
  });

  it('compares up to three vendors', async () => {
    renderAt('/vendors', presetEvent('wedding'));
    const user = userEvent.setup();
    for (const name of ['Lotus Courtyard Hall', 'Riverside Lawns', 'Annapurna Kitchen']) {
      await user.click(screen.getByRole('button', { name: `Compare ${name}` }));
    }
    await user.click(
      screen.getByRole('button', { name: 'Compare Spice Route Caterers' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /You can compare up to 3 vendors/,
    );
    const table = screen.getByRole('table', { name: /Comparison for 200 guests/ });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Criterion',
      'Lotus Courtyard Hall',
      'Riverside Lawns',
      'Annapurna Kitchen',
    ]);
    expect(within(table).getAllByText('Sample data (fictional)')).toHaveLength(3);
  });
});

describe('your vendors', () => {
  it.each(['Contact (optional, your note)', 'Service area (optional)'])(
    'explains invalid %s and focuses the field without saving',
    async (label) => {
      const storage = renderAt('/vendors', presetEvent('wedding'));
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Add vendor' }));
      await user.type(screen.getByLabelText(/^Vendor name/), 'Local hall');
      await user.selectOptions(screen.getByLabelText('Category (required)'), 'venue');
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value: 'Invalid\u0007text' } });
      await user.click(screen.getByRole('button', { name: 'Save vendor' }));
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription();
      expect(field).toHaveFocus();
      expect(saved(storage).vendors).toHaveLength(0);
      await user.clear(field);
      await user.type(field, 'Pune');
      expect(field).not.toHaveAttribute('aria-invalid');
      await user.click(screen.getByRole('button', { name: 'Save vendor' }));
      expect(saved(storage).vendors).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Add vendor' })).toHaveFocus();
    },
  );

  it('returns keyboard focus to Add vendor when the form is cancelled', async () => {
    renderAt('/vendors', presetEvent('wedding'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add vendor' }));
    await user.click(
      within(screen.getByRole('form', { name: 'Add a vendor' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect(screen.getByRole('button', { name: 'Add vendor' })).toHaveFocus();
  });

  it('shortlists a sample once, and adds your own vendor as needing confirmation', async () => {
    const storage = renderAt('/vendors', presetEvent('wedding'));
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Shortlist Lotus Courtyard Hall' }),
    );
    expect(status()).toMatch(/Shortlisted Lotus Courtyard Hall\. It is sample data/);
    expect(
      screen.queryByRole('button', { name: 'Shortlist Lotus Courtyard Hall' }),
    ).toBeNull();
    expect(saved(storage).vendors).toMatchObject([
      {
        name: 'Lotus Courtyard Hall',
        sampleId: 'sample.lotus-courtyard-hall',
        status: 'shortlisted',
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Add vendor' }));
    await user.type(screen.getByLabelText(/^Vendor name/), 'Neighbourhood hall');
    await user.click(screen.getByRole('button', { name: 'Save vendor' }));
    expect(screen.getByLabelText(/^Category \(required\)/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await user.selectOptions(screen.getByLabelText(/^Category \(required\)/), 'venue');
    await user.click(screen.getByRole('button', { name: 'Save vendor' }));
    const own = result('Neighbourhood hall');
    expect(within(own).getByText('Your record')).toBeInTheDocument();
    expect(within(own).getByText('Needs confirmation')).toBeInTheDocument();
    expect(within(own).getByText(/Service area not recorded/)).toBeInTheDocument();
  });

  it('records a booking as the organizer’s note, not a reservation', async () => {
    const lotus = {
      id: 'v-lotus',
      name: 'Lotus Courtyard Hall',
      kind: 'venue' as const,
      status: 'quoted' as const,
      quotePaise: null,
      sampleId: 'sample.lotus-courtyard-hall',
    };
    const record = applyOperations(presetEvent('wedding'), [
      { op: 'vendors/upsert', item: lotus },
    ]);
    if (!record) throw new Error('fixture');
    const storage = renderAt('/vendors', record);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Selection status'), 'booked');
    await user.type(
      screen.getByLabelText(/^Contact \(your note\)/),
      'Manager, front desk',
    );
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    expect(status()).toMatch(
      /recorded as booked\. This is your note: no reservation was made from this app/,
    );
    expect(
      screen.getByText(/does not contact vendors or make reservations/),
    ).toBeInTheDocument();
    expect(saved(storage).vendors[0]).toMatchObject({
      status: 'booked',
      contact: 'Manager, front desk',
    });
  });

  it('ticks checklist questions as the organizer’s own checks', async () => {
    const record = applyOperations(presetEvent('community'), [
      {
        op: 'vendors/upsert',
        item: {
          id: 'v1',
          name: 'Hall',
          kind: 'venue',
          status: 'contacted',
          quotePaise: null,
        },
      },
    ]);
    if (!record) throw new Error('fixture');
    const storage = renderAt('/vendors', record);
    for (const label of [
      /available on/,
      /Get the quote in writing/,
      /confirm in writing how they meet: wheelchair access/,
      /payment terms/,
      /cancellation and refund terms/,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    const box = screen.getByLabelText(/available on/);
    await userEvent.click(box);
    expect(saved(storage).vendors[0]?.checksDone).toEqual(['core.availability']);
    expect(screen.getByLabelText(/available on/)).toBeChecked();
  });
});

describe('agreed quotes and the budget', () => {
  it('links a quote to one expense, and repeating it does not duplicate the deposit (completion check)', async () => {
    const lotus = {
      id: 'v-lotus',
      name: 'Lotus Courtyard Hall',
      kind: 'venue' as const,
      status: 'quoted' as const,
      quotePaise: null,
      sampleId: 'sample.lotus-courtyard-hall',
    };
    const record = applyOperations(budgeted('wedding'), [
      { op: 'vendors/upsert', item: lotus },
    ]);
    if (!record) throw new Error('fixture');
    const venueHire = record.expenses.find((e) => e.templateId === 'expense.venue-hire');
    if (!venueHire) throw new Error('fixture');
    const storage = renderAt('/vendors', record);
    const user = userEvent.setup();

    const form = screen.getByRole('form', {
      name: 'Agreed quote for Lotus Courtyard Hall',
    });
    expect(within(form).getByLabelText(/Expense this quote covers/)).toHaveValue(
      venueHire.id,
    );
    await user.type(within(form).getByLabelText('Agreed total (required)'), '1,10,000');
    await user.type(within(form).getByLabelText(/^Deposit \(optional\)/), '30000');
    fireEvent.change(within(form).getByLabelText(/^Deposit paid on/), {
      target: { value: TODAY },
    });
    await user.click(within(form).getByRole('button', { name: 'Record agreed quote' }));
    expect(status()).toMatch(
      /Updated the linked expense “Venue hire”.*the deposit is part of the agreed total, not extra/,
    );

    const again = screen.getByRole('form', {
      name: 'Agreed quote for Lotus Courtyard Hall',
    });
    expect(within(again).queryByLabelText(/Expense this quote covers/)).toBeNull();
    const amount = within(again).getByLabelText('Agreed total (required)');
    expect(amount).toHaveValue('110000');
    await user.clear(amount);
    await user.type(amount, '115000');
    await user.click(within(again).getByRole('button', { name: 'Update agreed quote' }));

    const after = saved(storage);
    expect(after.expenses).toHaveLength(record.expenses.length);
    const linked = after.expenses.filter((e) => e.vendorId === lotus.id);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      id: venueHire.id,
      commitment: { basis: 'fixed', totalPaise: 11_500_000, depositPaise: 3_000_000 },
      payments: [{ id: depositPaymentId(lotus.id), amountPaise: 3_000_000, date: TODAY }],
    });
    const ledger = buildLedger(after, PLANNING_CONFIGURATION);
    expect(ledger.paidPaise).toBe(3_000_000);
    expect(ledger.reconciles).toBe(true);
    expect(after.vendors[0]?.status).toBe('quoted');
  });

  it('asks for a budget first when there is none', () => {
    const record = applyOperations(presetEvent('wedding'), [
      {
        op: 'vendors/upsert',
        item: {
          id: 'v1',
          name: 'Hall',
          kind: 'venue',
          status: 'quoted',
          quotePaise: null,
        },
      },
    ]);
    if (!record) throw new Error('fixture');
    renderAt('/vendors', record);
    expect(
      screen.getByText(/Create a budget on the Budget page first/),
    ).toBeInTheDocument();
  });
});

describe('the guest panel', () => {
  it('keeps RSVPs separate from the expected count and changes it only through a preview', async () => {
    const record = budgeted('birthday');
    const storage = renderAt('/', record);
    const user = userEvent.setup();
    const guests = screen.getByRole('region', { name: 'Guests' });

    await user.type(within(guests).getByLabelText(/^Name or alias/), 'Kulkarni family');
    await user.clear(within(guests).getByLabelText(/^Group size/));
    await user.type(within(guests).getByLabelText(/^Group size/), '4');
    await user.selectOptions(within(guests).getByLabelText('Reply'), 'accepted');
    await user.type(
      within(guests).getByLabelText(/^Dietary or access notes/),
      'One vegan',
    );
    await user.click(within(guests).getByRole('button', { name: 'Add guest' }));
    expect(saved(storage).guests[0]).toMatchObject({
      name: 'Kulkarni family',
      partySize: 4,
      rsvp: 'accepted',
      notes: 'One vegan',
    });

    await user.selectOptions(
      within(guests).getByLabelText('Reply from Kulkarni family'),
      'declined',
    );
    expect(
      within(guests).getByText(/The expected guest count is unchanged/),
    ).toBeInTheDocument();
    await user.selectOptions(
      within(guests).getByLabelText('Reply from Kulkarni family'),
      'accepted',
    );
    const unchanged = saved(storage);
    expect(unchanged.profile.guestCount).toBe(40);
    expect(buildLedger(unchanged, PLANNING_CONFIGURATION).forecastPaise).toBe(
      buildLedger(record, PLANNING_CONFIGURATION).forecastPaise,
    );

    await user.click(
      within(guests).getByRole('button', { name: 'Preview people who accepted (4)' }),
    );
    const preview = within(guests).getByRole('region', { name: 'Guest count preview' });
    expect(within(preview).getByText(/Expected guests: 40 → 4/)).toBeInTheDocument();
    await user.click(within(preview).getByRole('button', { name: 'Discard' }));
    expect(saved(storage).profile.guestCount).toBe(40);

    await user.clear(
      within(guests).getByLabelText('New expected guest count (required)'),
    );
    await user.type(
      within(guests).getByLabelText('New expected guest count (required)'),
      '45',
    );
    await user.click(within(guests).getByRole('button', { name: 'Preview' }));
    await user.click(
      within(guests).getByRole('button', { name: 'Use 45 expected guests' }),
    );
    expect(saved(storage).profile.guestCount).toBe(45);
  });

  it('edits a guest without asking for contact details', async () => {
    const record = applyOperations(presetEvent('birthday'), [
      {
        op: 'guests/upsert',
        item: {
          id: 'g1',
          name: 'Asha',
          partySize: 1,
          rsvp: 'invited',
          dietaryNeeds: [],
          accessibilityNeeds: [],
        },
      },
    ]);
    if (!record) throw new Error('fixture');
    const storage = renderAt('/', record);
    const user = userEvent.setup();
    const guests = screen.getByRole('region', { name: 'Guests' });
    expect(within(guests).queryByLabelText(/email|phone|birth/i)).toBeNull();
    await user.click(within(guests).getByRole('button', { name: 'Edit Asha' }));
    const form = within(guests).getByRole('form', { name: 'Edit Asha' });
    await user.clear(within(form).getByLabelText('Group size'));
    await user.type(within(form).getByLabelText('Group size'), '3');
    await user.type(
      within(form).getByLabelText(/^Dietary or access notes/),
      'Uses a walker',
    );
    await user.click(within(form).getByRole('button', { name: 'Save guest' }));
    expect(saved(storage).guests[0]).toMatchObject({
      partySize: 3,
      notes: 'Uses a walker',
      rsvp: 'invited',
    });
  });
});
