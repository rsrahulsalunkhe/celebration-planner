import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';

/** Every journey runs on this day, so dates and lead times are repeatable. */
export const TODAY = '2026-10-21';

interface Fixtures {
  /** Requests that tried to leave this machine (all are blocked). */
  outsideRequests: string[];
}

export const test = base.extend<Fixtures>({
  outsideRequests: [
    async ({ page }, provide) => {
      const blocked: string[] = [];
      // Nothing may be fetched from the internet: no SDK, no model, no fonts.
      await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => {
        blocked.push(route.request().url());
        return route.abort();
      });
      await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00+05:30`));
      await provide(blocked);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Runs axe-core for WCAG 2.0–2.2 A and AA rules. A pass shows only that these
 * automated rules found nothing; it does not prove the page is accessible.
 */
export async function expectNoAxeViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const found = results.violations.map(
    (v) =>
      `${v.id} (${v.impact ?? 'unknown'}): ${v.help} — ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
  expect(found, `axe violations in ${state}`).toEqual([]);
}
