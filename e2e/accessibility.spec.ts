import { expect, expectNoAxeViolations, test } from './fixtures.ts';
import { createDemo, goTo, startBudget, startTimeline } from './helpers.ts';

/*
 * Automated axe-core scans (WCAG 2.0–2.2 A and AA rules). Passing them shows
 * only that these rules found nothing in these states; manual keyboard, zoom
 * and screen reader checks are recorded separately in docs/TESTING.md.
 */

test('initial state: the welcome screen', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();
  await expectNoAxeViolations(page, 'the welcome screen');
});

test('populated planner: every section with a plan in it', async ({ page }) => {
  await createDemo(page, 'Wedding');
  await startBudget(page);
  await startTimeline(page);
  for (const section of [
    'Overview',
    'Budget',
    'Timeline',
    'Vendors',
    'Assistant',
    'Ideas',
    'Your data',
  ]) {
    await goTo(page, section);
    await expectNoAxeViolations(page, section);
  }
  await page.goto('./#/print');
  await expect(page.getByRole('heading', { level: 2, name: 'Checklist' })).toBeVisible();
  await expectNoAxeViolations(page, 'the printable plan');
});

test('open dialog: confirming a destructive action', async ({ page }) => {
  await createDemo(page, 'Birthday');
  await page.getByRole('button', { name: /^Delete / }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this event?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expectNoAxeViolations(page, 'the delete dialog');

  // Escape closes it and returns focus to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /^Delete / })).toBeFocused();
});

test.describe('keyboard, reflow and motion in a real browser', () => {
  test('works with the keyboard alone: skip link, navigation, a form and a dialog', async ({
    page,
  }) => {
    await createDemo(page, 'Wedding');
    // A fresh load, so nothing has focus yet.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The first Tab reaches the skip link, which moves focus to the page.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();

    // Navigation by keyboard puts focus on the new page's heading.
    await page.getByRole('link', { name: 'Budget', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Budget' })).toBeFocused();

    // A button removed by its own action leaves focus in the same place on the page.
    await page.getByRole('button', { name: 'Create starting budget' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Create starting budget' }),
    ).toHaveCount(0);
    await expect(page.locator(':focus')).not.toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(
      false,
    );

    // Focus stays inside an open dialog, and Escape returns it to the opener.
    await page.getByRole('link', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('Enter');
    const opener = page.getByRole('button', { name: /^Delete / });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete this event?' });
    // The page behind a modal dialog is inert: Tab moves only between the dialog's
    // buttons, and past the last one to the browser's own controls, never to the page.
    const places: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      places.push(
        await dialog.evaluate((d) =>
          d.contains(document.activeElement)
            ? (document.activeElement?.textContent ?? '')
            : document.activeElement === document.body
              ? 'outside the page'
              : 'PAGE BEHIND THE DIALOG',
        ),
      );
    }
    expect(places).not.toContain('PAGE BEHIND THE DIALOG');
    expect(places).toContain('Cancel');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  for (const width of [320, 640]) {
    test(`reflows without sideways scrolling at ${String(width)} CSS px`, async ({
      page,
    }) => {
      await createDemo(page, 'Wedding');
      await startBudget(page);
      await startTimeline(page);
      // 640 px is what a 1280 px window shows at 200% zoom.
      await page.setViewportSize({ width, height: 800 });
      for (const path of [
        '',
        'budget',
        'timeline',
        'vendors',
        'assistant',
        'ideas',
        'data',
        'print',
      ]) {
        await page.goto(`./#/${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `/${path} at ${String(width)} px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('turns off transitions when reduced motion is asked for', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    const duration = await page
      .getByRole('link', { name: 'Create an event' })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(',').every((d) => parseFloat(d) <= 0.0001)).toBe(true);
  });
});
