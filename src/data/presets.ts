import type { CalendarHelper } from '@/domain/dates.ts';
import { createEventRecord } from '@/domain/eventRecord.ts';
import type {
  AgeBand,
  DemoPresetId,
  EventRecord,
  EventType,
  Preferences,
  Setting,
} from '@/domain/types.ts';

/**
 * Fictional demonstration inputs. The amounts are arbitrary round numbers
 * chosen to exercise the planner; they are not recommended market budgets.
 */
export const DEMO_DISCLOSURE =
  'Fictional demonstration input. The budget is not a recommended market budget.';

export interface DemoPreset {
  id: DemoPresetId;
  label: string;
  summary: string;
  title: string;
  eventType: EventType;
  city: string;
  daysAhead: number;
  guestCount: number;
  budgetPaise: number;
  setting: Setting;
  ageBand?: AgeBand;
  preferences: Preferences;
}

export const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: 'wedding',
    label: 'Wedding',
    summary: '200 guests, ₹5,00,000, 90 days ahead',
    title: 'Demo wedding (fictional)',
    eventType: 'wedding',
    city: 'Pune',
    daysAhead: 90,
    guestCount: 200,
    budgetPaise: 50_000_000, // ₹5,00,000
    setting: 'indoor',
    preferences: {
      priorities: ['food', 'venue', 'photography'],
      dietaryNeeds: ['vegetarian'],
      accessibilityNeeds: [],
      culturalPreferences: [],
    },
  },
  {
    id: 'birthday',
    label: 'Birthday',
    summary: '40 guests, ₹50,000, 14 days ahead',
    title: 'Demo birthday party (fictional)',
    eventType: 'birthday',
    city: 'Nashik',
    daysAhead: 14,
    guestCount: 40,
    budgetPaise: 5_000_000, // ₹50,000
    setting: 'indoor',
    ageBand: '30-49',
    preferences: {
      priorities: ['food', 'entertainment'],
      dietaryNeeds: [],
      accessibilityNeeds: [],
      culturalPreferences: [],
    },
  },
  {
    id: 'community',
    label: 'Outdoor community event',
    summary: '150 guests, ₹2,00,000, 30 days ahead, wheelchair access',
    title: 'Demo community event (fictional)',
    eventType: 'community',
    city: 'Satara',
    daysAhead: 30,
    guestCount: 150,
    budgetPaise: 20_000_000, // ₹2,00,000
    setting: 'outdoor',
    preferences: {
      priorities: ['accessibility', 'guest-comfort'],
      dietaryNeeds: [],
      accessibilityNeeds: ['wheelchair-access'],
      culturalPreferences: [],
    },
  },
];

/**
 * Builds a demo event. The date comes from the injected calendar, so a demo
 * is always `daysAhead` days from whenever it is created.
 */
export function buildDemoEvent(
  preset: DemoPreset,
  options: { eventId: string; calendar: CalendarHelper },
): EventRecord {
  const { eventId, calendar } = options;
  return createEventRecord(
    {
      id: eventId,
      title: preset.title,
      eventType: preset.eventType,
      date: calendar.addDays(calendar.today(), preset.daysAhead),
      city: preset.city,
      guestCount: preset.guestCount,
      budgetPaise: preset.budgetPaise,
      setting: preset.setting,
      ...(preset.ageBand ? { ageBand: preset.ageBand } : {}),
      demoPresetId: preset.id,
    },
    preset.preferences,
  );
}
