import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '@/app/AppRoutes.tsx';
import { CalendarContext } from '@/app/state/plannerContext.ts';
import { PlannerProvider } from '@/app/state/PlannerProvider.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { startingBudgetOperations } from '@/domain/planning/budget.ts';
import { savedEnvelopeSchema } from '@/domain/schemas.ts';
import type { EventRecord } from '@/domain/types.ts';
import { SAVED_STATE_KEY, serializeSavedState } from '@/services/storage.ts';
import { MemoryStorage, TODAY, fixedCalendar, presetEvent } from '@/test/helpers.ts';

function budgetedWedding(): EventRecord {
  const record = presetEvent('wedding');
  const next = applyOperations(
    record,
    startingBudgetOperations(record, PLANNING_CONFIGURATION, TODAY),
  );
  if (!next) throw new Error('fixture');
  return next;
}

function renderBudget(record: EventRecord = budgetedWedding()) {
  const storage = new MemoryStorage();
  storage.data.set(
    SAVED_STATE_KEY,
    serializeSavedState({ activeEventId: record.profile.id, events: [record] }),
  );
  render(
    <MemoryRouter initialEntries={['/budget']}>
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

const fact = (label: string | RegExp) => {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
};
const status = () =>
  screen
    .getAllByRole('status')
    .map((s) => s.textContent)
    .join(' ')
    .trim();
const click = (name: string | RegExp) =>
  userEvent.click(screen.getByRole('button', { name }));

describe('starting a budget', () => {
  it('creates categories and illustrative estimates, clearly labelled', async () => {
    const storage = renderBudget(presetEvent('wedding'));
    expect(screen.getByRole('heading', { name: 'Start a budget' })).toBeInTheDocument();
    expect(screen.getByText(/fictional illustrations/)).toBeInTheDocument();
    await click('Create starting budget');

    expect(status()).toMatch(/Created a starting budget from illustrative rates/);
    const table = screen.getByRole('table', { name: /Targets, forecast/ });
    expect(within(table).getAllByText('Shared by weight').length).toBeGreaterThan(3);
    const expenses = screen.getByRole('table', { name: /Estimates, agreed amounts/ });
    expect(within(expenses).getAllByText('Illustrative rate').length).toBeGreaterThan(3);
    expect(saved(storage).budgetCategories.length).toBeGreaterThan(3);
    expect(saved(storage).tasks).toEqual([]);
  });
});

describe('the budget editor', () => {
  it('shows every money view and a headroom equation that adds up', () => {
    renderBudget();
    expect(fact('Total budget')).toBe('₹5,00,000');
    expect(fact(/^Reserve \(10%, default\)/)).toBe('₹50,000');
    expect(fact('Paid')).toBe('₹0');
    expect(
      screen.getByText(/Headroom = budget ₹5,00,000 − reserve ₹50,000 − forecast/),
    ).toBeInTheDocument();
    expect(screen.getByText(/All totals reconcile/)).toBeInTheDocument();
    // The bars are decorative and the table carries the same figures.
    expect(screen.getByText(/Exact figures are in the table below/)).toBeInTheDocument();
  });

  it('locks a manually edited target, re-shares the rest, and unlocks it explicitly', async () => {
    const storage = renderBudget();
    const user = userEvent.setup();
    const first = saved(storage).budgetCategories[0];
    if (!first) throw new Error('fixture');

    await user.click(
      screen.getByRole('button', { name: `Edit target for ${first.name}` }),
    );
    const input = screen.getByLabelText(`Target for ${first.name}, in rupees`);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await user.clear(input);
    await user.type(input, '1,00,000');
    await user.click(screen.getByRole('button', { name: 'Save and lock' }));

    expect(status()).toMatch(
      new RegExp(`${first.name} target set to ₹1,00,000 and locked`),
    );
    const after = saved(storage);
    const locked = after.budgetCategories.find((c) => c.id === first.id);
    expect(locked).toMatchObject({ plannedPaise: 10_000_000, plannedOrigin: 'user' });
    const total = after.budgetCategories.reduce((sum, c) => sum + c.plannedPaise, 0);
    expect(total).toBe(45_000_000);

    await user.click(screen.getByRole('button', { name: `Unlock ${first.name}` }));
    expect(saved(storage).budgetCategories.find((c) => c.id === first.id)).toMatchObject({
      plannedOrigin: 'generated',
      plannedPaise: first.plannedPaise,
    });
  });

  it('rejects a blank or malformed target instead of reading it as zero', async () => {
    const storage = renderBudget();
    const user = userEvent.setup();
    const before = saved(storage);
    const first = before.budgetCategories[0];
    if (!first) throw new Error('fixture');
    await user.click(
      screen.getByRole('button', { name: `Edit target for ${first.name}` }),
    );
    const input = screen.getByLabelText(`Target for ${first.name}, in rupees`);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save and lock' }));
    expect(screen.getByText(/Enter an amount in rupees/)).toBeInTheDocument();
    await user.type(input, '-500');
    await user.click(screen.getByRole('button', { name: 'Save and lock' }));
    expect(screen.getByText(/No minus sign or letters/)).toBeInTheDocument();
    expect(saved(storage)).toEqual(before);
  });

  it('adds a per-guest expense, agrees a total and records payments inside it', async () => {
    const storage = renderBudget();
    const user = userEvent.setup();
    const forecastBefore = fact('Forecast cost');

    await click('Add expense');
    await user.type(screen.getByLabelText(/^Name/), 'Welcome drinks');
    await user.selectOptions(screen.getByLabelText('Estimate is'), 'per-guest');
    const estimate = screen.getByLabelText(/Estimate per guest/);
    expect(estimate).toHaveAttribute('inputmode', 'decimal');
    await user.type(estimate, '150');
    expect(screen.getByText('× 200 guests = ₹30,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save new expense' }));
    expect(status()).toBe('Added Welcome drinks.');

    const added = saved(storage).expenses.find((e) => e.name === 'Welcome drinks');
    expect(added).toMatchObject({
      estimate: { basis: 'per-guest', perGuestPaise: 15_000 },
      estimateOrigin: 'user',
      commitment: null,
    });
    const row = screen.getByRole('row', { name: /Welcome drinks/ });
    expect(within(row).getByText('Your estimate')).toBeInTheDocument();
    expect(fact('Forecast cost')).not.toBe(forecastBefore);

    // Agree a fixed total: it replaces the estimate in the forecast.
    await user.click(screen.getByRole('button', { name: 'Edit Welcome drinks' }));
    await user.selectOptions(screen.getByLabelText(/Agreed with the vendor/), 'fixed');
    await user.type(screen.getByLabelText(/Agreed total/), '25000');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    const agreedRow = screen.getByRole('row', { name: /Welcome drinks/ });
    expect(within(agreedRow).getByText('Fixed ₹25,000')).toBeInTheDocument();
    const forecastAgreed = fact('Forecast cost');
    const headroomAgreed = fact('Headroom');

    // A payment above the agreed amount is refused; one inside it is recorded.
    await user.click(screen.getByRole('button', { name: 'Edit Welcome drinks' }));
    const amount = screen.getByLabelText('Payment amount');
    await user.type(amount, '30000');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(
      screen.getByText(/Only ₹25,000 of the agreed ₹25,000 is outstanding/),
    ).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '10000');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(status()).toMatch(/The forecast is unchanged; outstanding is now ₹15,000/);

    expect(fact('Forecast cost')).toBe(forecastAgreed);
    expect(fact('Headroom')).toBe(headroomAgreed);
    expect(fact('Paid')).toBe('₹10,000');
    expect(fact('Outstanding')).toBe('₹15,000');
    const final = saved(storage).expenses.find((e) => e.name === 'Welcome drinks');
    expect(final?.payments).toHaveLength(1);
    expect(final?.payments[0]).toMatchObject({ amountPaise: 1_000_000, date: TODAY });
  });

  it('does not clear an agreement that has payments', async () => {
    const record = budgetedWedding();
    const [first] = record.expenses;
    if (!first) throw new Error('fixture');
    const withPayment = applyOperations(record, [
      {
        op: 'expenses/upsert',
        item: {
          ...first,
          commitment: { basis: 'fixed', totalPaise: 1_000_000 },
          payments: [{ id: 'p1', amountPaise: 500_000, date: TODAY }],
        },
      },
    ]);
    if (!withPayment) throw new Error('fixture');
    const storage = renderBudget(withPayment);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `Edit ${first.name}` }));
    await user.selectOptions(screen.getByLabelText(/Agreed with the vendor/), 'none');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(
      screen.getByText(/Remove those payments before clearing it/),
    ).toBeInTheDocument();
    expect(saved(storage)).toEqual(withPayment);
  });
});

describe('what-if scenarios', () => {
  it('previews more guests without saving, then applies it', async () => {
    const storage = renderBudget();
    const user = userEvent.setup();
    const before = saved(storage);

    await click('Preview more guests');
    const preview = screen.getByRole('region', {
      name: /Preview: Increase guests by 20%/,
    });
    const metrics = within(preview).getByRole('table', { name: 'Before and after' });
    const guests = within(metrics).getByRole('row', { name: /Guests/ });
    expect(guests).toHaveTextContent('200');
    expect(guests).toHaveTextContent('240');
    expect(
      within(preview).getByText(/Fixed costs and agreed fixed totals/),
    ).toBeInTheDocument();
    expect(saved(storage)).toEqual(before);

    await user.click(within(preview).getByRole('button', { name: 'Apply' }));
    expect(status()).toMatch(/Applied: Increase guests by 20%/);
    const after = saved(storage);
    expect(after.profile.guestCount).toBe(240);
    expect(after.expenses).toEqual(before.expenses);
  });

  it('discards a preview without changing anything', async () => {
    const storage = renderBudget();
    const before = saved(storage);
    await click('Preview budget cut');
    await click('Discard');
    expect(status()).toBe('Discarded the preview. Nothing was changed.');
    expect(screen.queryByRole('region', { name: /Preview:/ })).not.toBeInTheDocument();
    expect(saved(storage)).toEqual(before);
  });

  it('marks a preview out of date after another edit and will not apply it', async () => {
    const storage = renderBudget();
    const user = userEvent.setup();
    await click('Preview budget cut');
    // Another edit: set the reserve directly.
    const reserve = screen.getByLabelText('Reserve, % of budget');
    await user.clear(reserve);
    await user.type(reserve, '12.5');
    await user.click(screen.getByRole('button', { name: 'Set reserve' }));
    expect(saved(storage).profile.reserveBasisPoints).toBe(1250);

    const preview = screen.getByRole('region', { name: /Preview: Reduce the budget/ });
    expect(within(preview).getByText(/This preview is out of date/)).toBeInTheDocument();
    expect(
      within(preview).queryByRole('button', { name: 'Apply' }),
    ).not.toBeInTheDocument();
    await user.click(within(preview).getByRole('button', { name: 'Preview again' }));
    expect(
      within(screen.getByRole('region', { name: /Preview: Reduce/ })).getByRole(
        'button',
        {
          name: 'Apply',
        },
      ),
    ).toBeInTheDocument();
  });

  it('keeps an impossible budget visible after applying a cut', async () => {
    const record = budgetedWedding();
    const [first] = record.budgetCategories;
    if (!first) throw new Error('fixture');
    const locked = applyOperations(record, [
      {
        op: 'budgetCategories/upsert',
        item: { ...first, plannedPaise: 44_000_000, plannedOrigin: 'user' },
      },
    ]);
    if (!locked) throw new Error('fixture');
    const storage = renderBudget(locked);
    const user = userEvent.setup();
    await click('Preview budget cut');
    const preview = screen.getByRole('region', { name: /Preview: Reduce/ });
    expect(
      within(preview).getAllByText(/No target is unlocked for you/).length,
    ).toBeGreaterThan(0);
    await user.click(within(preview).getByRole('button', { name: 'Apply' }));

    const after = saved(storage);
    expect(after.budgetCategories.find((c) => c.id === first.id)).toMatchObject({
      plannedPaise: 44_000_000,
      plannedOrigin: 'user',
    });
    expect(after.budgetCategories.every((c) => c.plannedPaise >= 0)).toBe(true);
    const checks = screen.getByRole('region', { name: 'Checks' });
    expect(
      within(checks).getByText(/Locked targets total ₹4,40,000/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: /Targets over the budget/ }),
    ).toBeInTheDocument();
  });

  it('gives a chosen priority more and locks what it raised', async () => {
    const storage = renderBudget();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Priority'), 'decor');
    await click('Preview priority');
    const preview = screen.getByRole('region', { name: /Preview: Give decor 20% more/ });
    const targets = within(preview).getByRole('table', {
      name: 'Category targets before and after',
    });
    expect(within(targets).getAllByText('Locked').length).toBeGreaterThan(0);
    await user.click(within(preview).getByRole('button', { name: 'Apply' }));
    const total = saved(storage).budgetCategories.reduce((s, c) => s + c.plannedPaise, 0);
    expect(total).toBe(45_000_000);
  });
});
