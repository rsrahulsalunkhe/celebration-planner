import type { CategoryTemplate, ExpenseTemplate } from '@/domain/planning/types.ts';
import type { AccessibilityNeed } from '@/domain/types.ts';

/** Rupees to paise, so configuration reads in rupees but is stored in paise. */
export const rs = (rupees: number): number => rupees * 100;

export const RATES_DISCLOSURE =
  'All rates are fictional illustrations for demonstration, not market prices or quotes. Replace them with real quotes; an agreed quote always overrides an estimate.';

export const accessCategory = (weight: number, rationale: string): CategoryTemplate => ({
  id: 'category.access',
  name: 'Accessibility and comfort',
  weight,
  priorities: ['accessibility', 'guest-comfort'],
  rationale,
});

interface AccessRates {
  ramps: number;
  stepFree: number;
  restrooms: number;
  seatingPerGuest: number;
  interpreter: number;
  quietSpace: number;
  largePrint: number;
}

const ACCESS_RATIONALE =
  'You listed this accessibility requirement, so it is budgeted as a required provision and is never offered as a saving.';

/**
 * One required expense per stated accessibility need. Each appears only when
 * the user listed that need, and is flagged so it cannot be silently cut.
 */
export function accessibilityExpenses(rates: AccessRates): ExpenseTemplate[] {
  const make = (
    need: AccessibilityNeed,
    id: string,
    name: string,
    rate: ExpenseTemplate['rate'],
  ): ExpenseTemplate => ({
    id,
    categoryId: 'category.access',
    name,
    rate,
    when: { kind: 'accessibility', anyOf: [need] },
    requirement: need,
    rationale: ACCESS_RATIONALE,
  });
  return [
    make(
      'wheelchair-access',
      'expense.wheelchair-ramps',
      'Ramps and wheelchair-accessible routes',
      { basis: 'fixed', amountPaise: rates.ramps },
    ),
    make(
      'step-free-route',
      'expense.step-free-route',
      'Step-free route (mats, levelling)',
      { basis: 'fixed', amountPaise: rates.stepFree },
    ),
    make('accessible-restrooms', 'expense.accessible-restrooms', 'Accessible restrooms', {
      basis: 'fixed',
      amountPaise: rates.restrooms,
    }),
    make('seating-areas', 'expense.seating-areas', 'Extra seating areas', {
      basis: 'per-guest',
      perGuestPaise: rates.seatingPerGuest,
    }),
    make('sign-language', 'expense.sign-language', 'Sign language interpreter', {
      basis: 'fixed',
      amountPaise: rates.interpreter,
    }),
    make('quiet-space', 'expense.quiet-space', 'Quiet space', {
      basis: 'fixed',
      amountPaise: rates.quietSpace,
    }),
    make('large-print', 'expense.large-print', 'Large-print materials', {
      basis: 'fixed',
      amountPaise: rates.largePrint,
    }),
  ];
}

/**
 * Stated dietary needs are budgeted across all guests because the plan does
 * not know how many guests have each need. That is deliberately cautious.
 */
export const dietaryExpense = (perGuestRupees: number): ExpenseTemplate => ({
  id: 'expense.dietary-provision',
  categoryId: 'category.food',
  name: 'Meals for stated dietary needs',
  rate: { basis: 'per-guest', perGuestPaise: rs(perGuestRupees) },
  when: { kind: 'dietary' },
  requirement: 'dietary',
  rationale:
    'You listed dietary needs. The headcount per need is unknown, so this is budgeted across all guests and is never offered as a saving.',
});

/** A backup for an outdoor setting. It is a precaution, not a weather forecast. */
export const weatherCoverExpense = (
  categoryId: string,
  rupees: number,
): ExpenseTemplate => ({
  id: 'expense.weather-cover',
  categoryId,
  name: 'Covered area or tent for backup',
  rate: { basis: 'fixed', amountPaise: rs(rupees) },
  when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
  rationale:
    'The event is at least partly outdoors, so a covered backup is budgeted. This is a precaution; the plan does not predict weather.',
});
