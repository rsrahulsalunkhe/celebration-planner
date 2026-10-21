import { z } from 'zod';
import { parseIsoDate } from './dates.ts';

/**
 * Documented limits. Every collection and text field is bounded so saved data
 * and forms cannot grow without limit. Change them here only; schemas, forms
 * and tests all read from this table.
 */
export const LIMITS = {
  events: 10,
  budgetCategories: 30,
  expenses: 200,
  tasks: 200,
  vendors: 100,
  guests: 1000,
  ideas: 100,
  paymentsPerExpense: 50,
  operationsPerChange: 20,
  messages: 200,
  priorities: 5,
  culturalPreferences: 10,
  guestCount: 5000,
  partySize: 20,
  /** INR 10,000,000,000 in paise; keeps sums of many items well inside safe integers. */
  maxMoneyPaise: 1_000_000_000_000,
  /** Serialized saved state larger than this is neither read nor written. */
  payloadChars: 2_000_000,
} as const;

/** The only currency. Money is always an integer number of paise. */
export const CURRENCY = 'INR';

export const EVENT_TYPES = ['wedding', 'birthday', 'community'] as const;
export const SETTINGS = ['indoor', 'outdoor', 'mixed'] as const;
export const AGE_BANDS = [
  'under-13',
  '13-17',
  '18-29',
  '30-49',
  '50-64',
  '65-plus',
] as const;
export const PRIORITIES = [
  'food',
  'venue',
  'photography',
  'entertainment',
  'decor',
  'guest-comfort',
  'accessibility',
  'sustainability',
  'ceremony',
] as const;
export const DIETARY_NEEDS = [
  'vegetarian',
  'vegan',
  'jain',
  'halal',
  'gluten-free',
  'nut-allergy',
  'dairy-free',
  'diabetic-friendly',
] as const;
export const ACCESSIBILITY_NEEDS = [
  'wheelchair-access',
  'step-free-route',
  'accessible-restrooms',
  'seating-areas',
  'sign-language',
  'quiet-space',
  'large-print',
] as const;
export const VENDOR_KINDS = [
  'venue',
  'catering',
  'photography',
  'music',
  'decor',
  'transport',
  'other',
] as const;
export const VENDOR_STATUSES = [
  'shortlisted',
  'contacted',
  'quoted',
  'booked',
  'declined',
] as const;
export const TASK_STATUSES = ['todo', 'in-progress', 'done'] as const;
export const RSVP_STATUSES = ['invited', 'accepted', 'declined'] as const;
export const IDEA_KINDS = ['theme', 'activity', 'decor', 'food', 'favour'] as const;
export const IDEA_STATUSES = ['suggested', 'saved', 'dismissed'] as const;
export const IDEA_SOURCES = ['built-in', 'user', 'assistant'] as const;
/** `generated` = a default computed by the planner; `user` = an explicit override. */
export const VALUE_ORIGINS = ['generated', 'user'] as const;
export const DEMO_PRESET_IDS = ['wedding', 'birthday', 'community'] as const;

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** Single-line text: trimmed, required, bounded, no control characters. */
export const singleLine = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((v) => !/\p{Cc}/u.test(v), `${label} contains unsupported characters`);

/** Optional multi-line note: trimmed, bounded; newlines and tabs allowed. */
export const multiLine = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .refine((v) => !/[^\P{Cc}\n\t]/u.test(v), `${label} contains unsupported characters`);

export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9._~:-]{1,160}$/, 'Invalid identifier');

/** Stable template identifier, e.g. `task.book-venue`. */
export const templateIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/, 'Invalid template identifier')
  .max(80);

export const isoDateSchema = z.iso
  .date({ error: 'Enter a valid calendar date' })
  .refine((v) => {
    const date = parseIsoDate(v);
    if (!date) return false;
    const year = date.getUTCFullYear();
    return year >= MIN_YEAR && year <= MAX_YEAR;
  }, `Date must be a real calendar date between ${MIN_YEAR} and ${MAX_YEAR}`);

export const boundedInt = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

/** Zero or more paise. Never coerced from blank input. */
export const paiseSchema = boundedInt('Amount', 0, LIMITS.maxMoneyPaise);
export const positivePaiseSchema = boundedInt('Amount', 1, LIMITS.maxMoneyPaise);

export const uniqueArray = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(max, `At most ${max} items`)
    .refine(
      (items) => new Set(items).size === items.length,
      'Duplicate items are not allowed',
    );
