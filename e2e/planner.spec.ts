import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { TODAY, expect, test } from './fixtures.ts';
import {
  createDemo,
  createEvent,
  goTo,
  savedEvents,
  startBudget,
  startTimeline,
  type EventDetails,
} from './helpers.ts';

/** A budget line's forecast, read from the printable plan's "Budget lines" table. */
async function forecastOf(page: Page, item: string): Promise<string> {
  await page.goto('./#/print');
  const row = page
    .getByRole('region', { name: 'Budget lines' })
    .getByRole('row', { name: new RegExp(`^${item}\\b`) });
  await expect(row).toHaveCount(1);
  // Cells after the item name: category, forecast, based on, paid.
  return (await row.getByRole('cell').nth(1).textContent()) ?? '';
}

test.describe('journey 1: each event type gets its own plan', () => {
  const cases: (EventDetails & {
    category: string;
    task: string;
    notCategories: string[];
  })[] = [
    {
      title: 'Asha and Ravi wedding',
      type: 'wedding',
      date: '2027-02-14',
      city: 'Pune',
      guests: '180',
      budget: '6,00,000',
      setting: 'indoor',
      category: 'Ceremony essentials',
      task: 'Shortlist and book the venue',
      notCategories: ['Return gifts', 'Site and permissions'],
    },
    {
      title: 'Meera turns eight',
      type: 'birthday',
      date: '2027-01-09',
      city: 'Nagpur',
      guests: '30',
      budget: '40,000',
      setting: 'indoor',
      category: 'Return gifts',
      task: 'Decide who to invite',
      notCategories: ['Ceremony essentials', 'Site and permissions'],
    },
    {
      title: 'Lake clean-up day',
      type: 'community',
      date: '2027-03-06',
      city: 'Bhopal',
      guests: '120',
      budget: '75,000',
      setting: 'outdoor',
      category: 'Site and permissions',
      task: 'Check and apply for local permissions',
      notCategories: ['Ceremony essentials', 'Return gifts'],
    },
  ];

  for (const event of cases) {
    test(`a ${event.type} plan has its own budget categories and tasks`, async ({
      page,
    }) => {
      await createEvent(page, event);
      await startBudget(page);
      const main = page.getByRole('main');
      await expect(main.getByText(event.category, { exact: true }).first()).toBeVisible();
      for (const other of event.notCategories) {
        await expect(main.getByText(other, { exact: true })).toHaveCount(0);
      }
      await startTimeline(page);
      await expect(
        page.getByRole('heading', { name: event.task, exact: true }).first(),
      ).toBeVisible();
    });
  }
});

test('journey 2: cutting the budget shows a real shortfall and ways to close it', async ({
  page,
}) => {
  await createDemo(page, 'Wedding');
  await startBudget(page);
  await expect(page.getByText(/over the whole budget/)).toHaveCount(0);

  await goTo(page, 'Overview');
  await page.getByRole('button', { name: 'Edit event' }).click();
  await page.getByLabel(/^Budget/).fill('1,00,000');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await goTo(page, 'Budget');
  await expect(page.getByText(/₹[\d,]+ over the whole budget/).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Ways to close the gap' }),
  ).toBeVisible();
});

test('journey 3: more guests raise per-guest costs and leave fixed costs alone', async ({
  page,
}) => {
  await createDemo(page, 'Wedding');
  await startBudget(page);
  const cateringBefore = await forecastOf(page, 'Catering');
  const venueBefore = await forecastOf(page, 'Venue hire');

  await page.goto('./#/budget');
  await page.getByRole('button', { name: 'Preview more guests' }).click();
  const preview = page.getByRole('region', { name: /Preview: Increase guests by 20%/ });
  await expect(preview).toBeVisible();
  // A preview changes nothing until it is applied.
  expect(await forecastOf(page, 'Catering')).toBe(cateringBefore);

  await page.goto('./#/budget');
  await page.getByRole('button', { name: 'Preview more guests' }).click();
  await page
    .getByRole('region', { name: /Preview: Increase guests by 20%/ })
    .getByRole('button', { name: 'Apply' })
    .click();
  await expect(page.getByText(/Applied: Increase guests by 20%/)).toBeVisible();

  const cateringAfter = await forecastOf(page, 'Catering');
  const rupees = (text: string) => Number(text.replace(/[^\d]/g, ''));
  expect(rupees(cateringAfter)).toBeGreaterThan(rupees(cateringBefore));
  expect(await forecastOf(page, 'Venue hire')).toBe(venueBefore);
});

test('journey 4: a completed task and an event edit survive a reload', async ({
  page,
}) => {
  await createDemo(page, 'Birthday');
  await startTimeline(page);
  const markDone = page.getByRole('button', { name: /^Mark done: / }).first();
  const task = ((await markDone.getAttribute('aria-label')) ?? '').replace(
    'Mark done: ',
    '',
  );
  await markDone.click();
  await expect(page.getByRole('button', { name: `Reopen: ${task}` })).toBeVisible();

  await goTo(page, 'Overview');
  await page.getByRole('button', { name: 'Edit event' }).click();
  await page.getByLabel(/^City/).fill('Mysuru');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Mysuru').first()).toBeVisible();

  await page.reload();
  await expect(page.getByText('Mysuru').first()).toBeVisible();
  await goTo(page, 'Timeline');
  await expect(page.getByRole('button', { name: `Reopen: ${task}` })).toBeVisible();
});

test('journey 5: recording the same vendor quote twice counts it once', async ({
  page,
}) => {
  await createDemo(page, 'Wedding');
  await startBudget(page);
  await goTo(page, 'Vendors');
  await page.getByRole('button', { name: 'Shortlist Lotus Courtyard Hall' }).click();

  for (const button of ['Record agreed quote', 'Update agreed quote']) {
    const form = page.getByRole('form', {
      name: 'Agreed quote for Lotus Courtyard Hall',
    });
    await form.getByLabel('Agreed total (required)').fill('1,10,000');
    await form.getByLabel(/^Deposit \(optional\)/).fill('30000');
    await form.getByLabel(/^Deposit paid on/).fill(TODAY);
    await form.getByRole('button', { name: button }).click();
    await expect(
      page.getByText(/deposit is part of the agreed total, not extra/),
    ).toBeVisible();
  }

  await page.goto('./#/print');
  const lines = page.getByRole('region', { name: 'Budget lines' });
  const venue = lines.getByRole('row', { name: /^Venue hire\b/ });
  await expect(venue).toHaveCount(1);
  await expect(venue.getByRole('cell').nth(1)).toHaveText('₹1,10,000');
  await expect(venue.getByRole('cell').nth(2)).toHaveText('Agreed amount');
  await expect(venue.getByRole('cell').nth(3)).toHaveText('₹30,000');
  const summary = page.getByRole('heading', { name: 'Summary' }).locator('..');
  await expect(summary).toContainText('Agreed with vendors₹1,10,000');
  await expect(summary).toContainText('₹30,000 / ₹80,000');
});

test('journey 6: a plan exports and imports as a copy, and a bad file changes nothing', async ({
  page,
}) => {
  await createDemo(page, 'Outdoor community event');
  await startBudget(page);
  await goTo(page, 'Your data');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export plan (JSON)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-plan\.json$/);
  const exported = await readFile(await file.path(), 'utf8');
  expect(JSON.parse(exported)).toMatchObject({
    format: 'celebration-planner/event',
    version: 1,
  });

  const before = await savedEvents(page);
  const input = page.getByLabel(/Plan file/);
  await input.setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      '{"format":"celebration-planner/event","version":1,"event":{"profile":{"budgetPaise":12.5}}}',
    ),
  });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(
    'The plan in this file is not valid, so nothing was imported',
  );
  await expect(alert).toContainText('Your saved plans have not changed');
  expect(await savedEvents(page)).toEqual(before);

  await input.setInputFiles({
    name: 'community-plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported),
  });
  await expect(
    page.getByRole('heading', { name: 'Preview of community-plan.json' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Import as a copy' }).click();
  await expect(page.getByText(/^Imported “.+ \(copy\)” as a new event/)).toBeVisible();

  const after = await savedEvents(page);
  expect(after).toHaveLength(2);
  expect(after[1]?.profile.id).not.toBe(after[0]?.profile.id);
  expect(after[1]?.profile.title).toBe(`${after[0]?.profile.title ?? ''} (copy)`);
  await expect(page.getByLabel('Active event')).toHaveValue(after[1]?.profile.id ?? '');
});
