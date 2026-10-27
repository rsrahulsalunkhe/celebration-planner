import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

export type DemoLabel = 'Wedding' | 'Birthday' | 'Outdoor community event';

export async function createDemo(page: Page, label: DemoLabel) {
  await page.goto('./#/new');
  await page.getByRole('button', { name: `Create demo: ${label}` }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(fictional)');
}

export interface EventDetails {
  title: string;
  type: 'wedding' | 'birthday' | 'community';
  date: string;
  city: string;
  guests: string;
  budget: string;
  setting: 'indoor' | 'outdoor' | 'mixed';
}

/** Fills the New event form the way a person would, then creates the event. */
export async function createEvent(page: Page, details: EventDetails) {
  await page.goto('./#/new');
  await page.getByLabel(/^Title/).fill(details.title);
  await page.getByLabel(/^Event type/).selectOption(details.type);
  await page.getByLabel(/^Date/).fill(details.date);
  await page.getByLabel(/^City/).fill(details.city);
  await page.getByLabel(/^Expected guests/).fill(details.guests);
  await page.getByLabel(/^Budget/).fill(details.budget);
  await page.getByLabel(/^Setting/).selectOption(details.setting);
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: details.title }),
  ).toBeVisible();
}

export async function goTo(page: Page, section: string) {
  // The sidebar holds the main navigation and, below it, Your data.
  await page
    .getByRole('complementary', { name: 'Events and navigation' })
    .getByRole('link', { name: section, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
}

export async function startBudget(page: Page) {
  await goTo(page, 'Budget');
  await page.getByRole('button', { name: 'Create starting budget' }).click();
  await expect(page.getByRole('button', { name: 'Create starting budget' })).toHaveCount(
    0,
  );
}

export async function startTimeline(page: Page) {
  await goTo(page, 'Timeline');
  await page.getByRole('button', { name: 'Create timeline from the plan' }).click();
  await expect(
    page.getByRole('button', { name: 'Create timeline from the plan' }),
  ).toHaveCount(0);
}

/** The saved events, read from this app's own storage key. */
export async function savedEvents(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('celebration-planner:saved-state');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      data: { events: { profile: { id: string; title: string; revision: number } }[] };
    };
    return parsed.data.events;
  });
}
