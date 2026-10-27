import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { createDemo, goTo, savedEvents } from './helpers.ts';
import { fakeCalls, useFakeLocalAi } from './localAi.ts';

/*
 * Journeys 7 and 8 use a stand-in for the WebLLM SDK (e2e/fakes): they check
 * how the app handles the local AI adapter's states, not what a model writes.
 * Real inference is covered by the manual smoke test in docs/TESTING.md.
 */

const card = (page: Page) => page.getByRole('region', { name: 'Local AI (optional)' });
const messages = (page: Page) => page.getByRole('region', { name: 'Messages' });
/** The newest message (not a list item inside one). */
const lastMessage = (page: Page) =>
  messages(page).locator('ol').first().locator(':scope > li').last();

async function ask(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
}

async function startLocalAi(page: Page) {
  await card(page).getByRole('button', { name: 'Enable local AI' }).click();
  await card(page).getByRole('button', { name: 'Download and start' }).click();
  await expect(
    card(page).getByRole('button', { name: 'Turn off local AI' }),
  ).toBeVisible();
}

test.describe('journey 7: local AI adapter states (stand-in SDK)', () => {
  test('unsupported: says why, and the guided planner still answers', async ({
    page,
  }) => {
    await useFakeLocalAi(page, { gpu: false });
    await createDemo(page, 'Wedding');
    await goTo(page, 'Assistant');
    await card(page).getByRole('button', { name: 'Enable local AI' }).click();
    await expect(card(page)).toContainText('This browser does not offer WebGPU');
    await expect(
      card(page).getByRole('button', { name: 'Download and start' }),
    ).toHaveCount(0);

    await ask(page, 'Set guests to 220');
    const reply = lastMessage(page);
    await expect(reply).toContainText('Guided planner');
    await expect(reply.getByRole('button', { name: 'Apply change' })).toBeVisible();
    expect((await fakeCalls(page)).loads).toBe(0);
  });

  test('failed: reports the failure once and retries only when asked', async ({
    page,
  }) => {
    await useFakeLocalAi(page, { failLoad: 'Failed to fetch' });
    await createDemo(page, 'Wedding');
    await goTo(page, 'Assistant');
    await card(page).getByRole('button', { name: 'Enable local AI' }).click();
    await card(page).getByRole('button', { name: 'Download and start' }).click();
    await expect(card(page)).toContainText(/could not be downloaded/);
    await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect((await fakeCalls(page)).loads).toBe(1);
  });

  test('stopped: a download can be stopped', async ({ page }) => {
    await useFakeLocalAi(page, { holdLoad: true });
    await createDemo(page, 'Wedding');
    await goTo(page, 'Assistant');
    await card(page).getByRole('button', { name: 'Enable local AI' }).click();
    await card(page).getByRole('button', { name: 'Download and start' }).click();
    await expect(card(page)).toContainText('40%');
    await card(page).getByRole('button', { name: 'Stop download' }).click();
    await expect(card(page)).toContainText('Download stopped');
    await expect(
      card(page).getByRole('button', { name: 'Enable local AI' }),
    ).toBeVisible();
  });

  test('successful: a labelled draft that can be saved to Ideas, then turned off', async ({
    page,
    outsideRequests,
  }) => {
    await useFakeLocalAi(page);
    await createDemo(page, 'Wedding');
    await goTo(page, 'Assistant');
    await startLocalAi(page);

    await ask(page, 'Suggest theme ideas for this event.');
    const reply = lastMessage(page);
    await expect(reply).toContainText('Lantern courtyard welcome');
    await expect(reply).toContainText('AI-written draft');
    await expect(page.getByText('Local AI replied.')).toBeAttached();

    await reply
      .getByRole('button', { name: 'Save to Ideas: Lantern courtyard welcome' })
      .click();
    await expect(reply).toContainText('Saved to Ideas.');

    // Number commands still go to the planner's rules, not the model.
    await ask(page, 'Set guests to 220');
    await expect(lastMessage(page)).toContainText('Guided planner');

    await card(page).getByRole('button', { name: 'Turn off local AI' }).click();
    await expect(card(page)).toContainText('The model was unloaded from memory');
    const calls = await fakeCalls(page);
    expect(calls).toMatchObject({ loads: 1, generations: 1, unloads: 1 });

    await goTo(page, 'Ideas');
    const yours = page.getByRole('region', { name: 'Your ideas' });
    await expect(yours).toContainText('Lantern courtyard welcome');
    await expect(yours).toContainText('Local AI draft');
    expect(outsideRequests).toEqual([]);
  });
});

test('journey 8: switching events during a reply discards it everywhere', async ({
  page,
}) => {
  await useFakeLocalAi(page, { replyDelayMs: 150 });
  await createDemo(page, 'Wedding');
  await createDemo(page, 'Birthday');
  const [wedding, birthday] = await savedEvents(page);
  if (!wedding || !birthday) throw new Error('two events expected');

  await goTo(page, 'Assistant');
  await startLocalAi(page);
  await ask(page, 'Suggest theme ideas for this event.');
  // While a model writes, the button that stops it is called Stop.
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

  // Switch to the other event while the reply is still being written.
  await page.getByLabel('Active event').selectOption(wedding.profile.id);
  await expect(page.getByLabel('Active event')).toHaveValue(wedding.profile.id);
  await expect.poll(async () => (await fakeCalls(page)).interrupts).toBeGreaterThan(0);

  // Long enough for the whole reply to have arrived had it not been stopped.
  await page.waitForTimeout(4_000);
  await expect(page.getByText('Lantern courtyard welcome')).toHaveCount(0);

  await page.getByLabel('Active event').selectOption(birthday.profile.id);
  await expect(messages(page)).toContainText('Suggest theme ideas for this event.');
  await expect(page.getByText('Lantern courtyard welcome')).toHaveCount(0);
  // Nothing from the discarded reply reached saved data either.
  const events = await page.evaluate(() =>
    localStorage.getItem('celebration-planner:saved-state'),
  );
  expect(events).not.toContain('Lantern courtyard welcome');
});
