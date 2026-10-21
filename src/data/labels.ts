import type {
  AccessibilityNeed,
  AgeBand,
  DietaryNeed,
  EventType,
  Priority,
  Setting,
  PlanningTask,
  TaskCategory,
} from '@/domain/types.ts';
import type { Importance, Urgency } from '@/domain/planning/types.ts';

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

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  planning: 'Planning and money',
  guests: 'Guests and invitations',
  venue: 'Venue or site',
  food: 'Food and drink',
  suppliers: 'Suppliers and bookings',
  access: 'Access',
  volunteers: 'Volunteers',
  safety: 'Safety and backups',
  celebration: 'The celebration itself',
  'wrap-up': 'Wrap-up',
};

export const TASK_STATUS_LABELS: Record<PlanningTask['status'], string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
};

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  critical: 'Critical',
  important: 'Important',
  routine: 'Routine',
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  done: 'Done',
  overdue: 'Overdue',
  'due-today': 'Due today',
  'due-soon': 'Due within a week',
  upcoming: 'Later',
};
