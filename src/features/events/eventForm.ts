import { formatMoneyInput, parseMoney } from '@/domain/money.ts';
import { LIMITS } from '@/domain/primitives.ts';
import { eventProfileSchema, preferencesSchema } from '@/domain/schemas.ts';
import type {
  AccessibilityNeed,
  AgeBand,
  DietaryNeed,
  EventProfile,
  EventRecord,
  EventType,
  Preferences,
  Priority,
  Setting,
} from '@/domain/types.ts';

/** Raw form state: everything is text or a list, so blank stays blank. */
export interface EventFormValues {
  title: string;
  eventType: EventType | '';
  date: string;
  city: string;
  guestCount: string;
  budget: string;
  setting: Setting | '';
  ageBand: AgeBand | '';
  priorities: Priority[];
  dietaryNeeds: DietaryNeed[];
  dietaryNotes: string;
  accessibilityNeeds: AccessibilityNeed[];
  accessibilityNotes: string;
  culturalPreferences: string;
}

export type FieldName = keyof EventFormValues;
export type FormErrors = Partial<Record<FieldName, string>>;

/** Order used for the error summary and for focusing the first problem. */
export const FIELD_ORDER: readonly FieldName[] = [
  'title',
  'eventType',
  'date',
  'city',
  'guestCount',
  'budget',
  'setting',
  'ageBand',
  'priorities',
  'dietaryNeeds',
  'dietaryNotes',
  'accessibilityNeeds',
  'accessibilityNotes',
  'culturalPreferences',
];

export const emptyFormValues: EventFormValues = {
  title: '',
  eventType: '',
  date: '',
  city: '',
  guestCount: '',
  budget: '',
  setting: '',
  ageBand: '',
  priorities: [],
  dietaryNeeds: [],
  dietaryNotes: '',
  accessibilityNeeds: [],
  accessibilityNotes: '',
  culturalPreferences: '',
};

export function valuesFromRecord(record: EventRecord): EventFormValues {
  const { profile, preferences } = record;
  return {
    title: profile.title,
    eventType: profile.eventType,
    date: profile.date,
    city: profile.city,
    guestCount: String(profile.guestCount),
    budget: formatMoneyInput(profile.budgetPaise),
    setting: profile.setting,
    ageBand: profile.ageBand ?? '',
    priorities: [...preferences.priorities],
    dietaryNeeds: [...preferences.dietaryNeeds],
    dietaryNotes: preferences.dietaryNotes ?? '',
    accessibilityNeeds: [...preferences.accessibilityNeeds],
    accessibilityNotes: preferences.accessibilityNotes ?? '',
    culturalPreferences: preferences.culturalPreferences.join(', '),
  };
}

export type EditableProfile = Omit<EventProfile, 'id' | 'revision' | 'demoPresetId'>;

export type FormResult =
  | { ok: true; profile: EditableProfile; preferences: Preferences }
  | { ok: false; errors: FormErrors };

const PROFILE_FIELD_FOR_PATH: Record<string, FieldName> = {
  title: 'title',
  eventType: 'eventType',
  date: 'date',
  city: 'city',
  guestCount: 'guestCount',
  budgetPaise: 'budget',
  setting: 'setting',
  ageBand: 'ageBand',
  priorities: 'priorities',
  dietaryNeeds: 'dietaryNeeds',
  dietaryNotes: 'dietaryNotes',
  accessibilityNeeds: 'accessibilityNeeds',
  accessibilityNotes: 'accessibilityNotes',
  culturalPreferences: 'culturalPreferences',
};

const optionalText = (value: string): string | undefined => value.trim() || undefined;

/** Comma- or line-separated tags; blanks are dropped, nothing is invented. */
function splitTags(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Turns raw form text into a validated profile and preferences. Blank or
 * malformed numbers become field errors; they are never turned into zero.
 */
export function validateEventForm(values: EventFormValues): FormResult {
  const errors: FormErrors = {};

  if (values.eventType === '') errors.eventType = 'Choose an event type';
  if (values.setting === '') errors.setting = 'Choose indoor, outdoor or both';

  const guestText = values.guestCount.trim();
  let guestCount = Number.NaN;
  if (guestText === '') {
    errors.guestCount = 'Enter the expected number of guests';
  } else if (!/^\d+$/.test(guestText) || !Number.isSafeInteger(Number(guestText))) {
    errors.guestCount = 'Enter a whole number, like 150';
  } else {
    guestCount = Number(guestText);
  }

  const budgetText = values.budget.trim();
  let budgetPaise = Number.NaN;
  if (budgetText === '') {
    errors.budget = 'Enter the total budget in rupees';
  } else {
    const parsed = parseMoney(budgetText, 'INR');
    if (parsed === null) {
      errors.budget = 'Enter rupees like 500000 or 1,25,000.50 (up to 2 decimal places)';
    } else {
      budgetPaise = parsed;
    }
  }

  // Only birthdays have an age band; the field is hidden for other types.
  const ageBand =
    values.eventType === 'birthday' && values.ageBand !== '' ? values.ageBand : undefined;

  const profileCandidate = {
    id: 'form',
    revision: 0,
    title: values.title,
    eventType: values.eventType,
    date: values.date,
    city: values.city,
    guestCount,
    budgetPaise,
    setting: values.setting,
    ...(ageBand ? { ageBand } : {}),
  };
  const profileParsed = eventProfileSchema.safeParse(profileCandidate);

  const dietaryNotes = optionalText(values.dietaryNotes);
  const accessibilityNotes = optionalText(values.accessibilityNotes);
  const preferencesParsed = preferencesSchema.safeParse({
    priorities: values.priorities,
    dietaryNeeds: values.dietaryNeeds,
    ...(dietaryNotes ? { dietaryNotes } : {}),
    accessibilityNeeds: values.accessibilityNeeds,
    ...(accessibilityNotes ? { accessibilityNotes } : {}),
    culturalPreferences: splitTags(values.culturalPreferences),
  });

  for (const parsed of [profileParsed, preferencesParsed]) {
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      const field = PROFILE_FIELD_FOR_PATH[String(issue.path[0])];
      // Fields that already have a friendlier message above keep it.
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }

  if (
    !profileParsed.success ||
    !preferencesParsed.success ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  const { id: _id, revision: _revision, ...profile } = profileParsed.data;
  return { ok: true, profile, preferences: preferencesParsed.data };
}

/** Limits shown next to fields so the rules are visible before submitting. */
export const FORM_HINTS = {
  guestCount: `Whole number, 1 to ${LIMITS.guestCount.toLocaleString('en-IN')}.`,
  budget: 'Total in rupees (₹). Paise are allowed, like 1250.50.',
  culturalPreferences: `Optional. Your own words, separated by commas (up to ${LIMITS.culturalPreferences}). Used only to shape suggestions.`,
} as const;
