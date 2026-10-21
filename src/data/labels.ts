import type {
  AccessibilityNeed,
  AgeBand,
  DietaryNeed,
  EventType,
  Priority,
  Setting,
} from '@/domain/types.ts';

// Display text for the fixed vocabularies in `domain/primitives.ts`.

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  community: 'Community event',
};

export const SETTING_LABELS: Record<Setting, string> = {
  indoor: 'Indoor',
  outdoor: 'Outdoor',
  mixed: 'Indoor and outdoor',
};

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  'under-13': 'Under 13',
  '13-17': '13 to 17',
  '18-29': '18 to 29',
  '30-49': '30 to 49',
  '50-64': '50 to 64',
  '65-plus': '65 and over',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  food: 'Food',
  venue: 'Venue',
  photography: 'Photography',
  entertainment: 'Entertainment',
  decor: 'Decor',
  'guest-comfort': 'Guest comfort',
  accessibility: 'Accessibility',
  sustainability: 'Sustainability',
  ceremony: 'Ceremony',
};

export const DIETARY_LABELS: Record<DietaryNeed, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  jain: 'Jain',
  halal: 'Halal',
  'gluten-free': 'Gluten-free',
  'nut-allergy': 'Nut allergy',
  'dairy-free': 'Dairy-free',
  'diabetic-friendly': 'Diabetic-friendly',
};

export const ACCESSIBILITY_LABELS: Record<AccessibilityNeed, string> = {
  'wheelchair-access': 'Wheelchair access',
  'step-free-route': 'Step-free route',
  'accessible-restrooms': 'Accessible restrooms',
  'seating-areas': 'Seating areas',
  'sign-language': 'Sign language interpreter',
  'quiet-space': 'Quiet space',
  'large-print': 'Large-print materials',
};
