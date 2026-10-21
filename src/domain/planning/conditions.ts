import { formatDate } from '../dates.ts';
import type { Condition, PlanningContext } from './types.ts';

/** True when a template applies to the event. A missing condition always applies. */
export function matches(condition: Condition | undefined, ctx: PlanningContext): boolean {
  if (!condition) return true;
  const { profile, preferences } = ctx;
  switch (condition.kind) {
    case 'setting':
      return condition.anyOf.includes(profile.setting);
    case 'accessibility':
      return condition.anyOf
        ? condition.anyOf.some((need) => preferences.accessibilityNeeds.includes(need))
        : preferences.accessibilityNeeds.length > 0;
    case 'dietary':
      return condition.anyOf
        ? condition.anyOf.some((need) => preferences.dietaryNeeds.includes(need))
        : preferences.dietaryNeeds.length > 0;
    case 'priority':
      return condition.anyOf.some((p) => preferences.priorities.includes(p));
    case 'ageBand':
      return profile.ageBand !== undefined && condition.anyOf.includes(profile.ageBand);
    case 'guests':
      return (
        (condition.min === undefined || profile.guestCount >= condition.min) &&
        (condition.max === undefined || profile.guestCount <= condition.max)
      );
    case 'any':
      return condition.of.some((c) => matches(c, ctx));
    case 'all':
      return condition.of.every((c) => matches(c, ctx));
    case 'not':
      return !matches(condition.of, ctx);
  }
}

/** Fills `{guests}`, `{city}` and `{date}` so checklist text names the actual event. */
export function fillTokens(text: string, ctx: PlanningContext): string {
  const { profile } = ctx;
  return text
    .replaceAll('{guests}', String(profile.guestCount))
    .replaceAll('{city}', profile.city)
    .replaceAll('{date}', formatDate(profile.date));
}

/** Truncates to a schema length limit without cutting mid-sentence noise. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
