import type { z } from 'zod';
import type {
  assistantMessageSchema,
  budgetCategorySchema,
  changeOperationSchema,
  eventProfileSchema,
  eventRecordSchema,
  expenseItemSchema,
  guestRecordSchema,
  ideaSchema,
  paymentSchema,
  planningTaskSchema,
  preferencesSchema,
  proposedChangeSchema,
  runOrderItemSchema,
  savedAppStateSchema,
  savedEnvelopeSchema,
  vendorSchema,
  COLLECTION_NAMES,
} from './schemas.ts';
import type {
  ACCESSIBILITY_NEEDS,
  AGE_BANDS,
  DEMO_PRESET_IDS,
  DIETARY_NEEDS,
  EVENT_TYPES,
  PRIORITIES,
  SETTINGS,
  TASK_CATEGORIES,
  TASK_KINDS,
  VALUE_ORIGINS,
} from './primitives.ts';

// Types are inferred from the Zod schemas so validation and typing cannot drift.
export type EventProfile = z.infer<typeof eventProfileSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type BudgetCategory = z.infer<typeof budgetCategorySchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type ExpenseItem = z.infer<typeof expenseItemSchema>;
export type PlanningTask = z.infer<typeof planningTaskSchema>;
export type Vendor = z.infer<typeof vendorSchema>;
export type GuestRecord = z.infer<typeof guestRecordSchema>;
export type Idea = z.infer<typeof ideaSchema>;
export type RunOrderItem = z.infer<typeof runOrderItemSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ChangeOperation = z.infer<typeof changeOperationSchema>;
export type ProposedChange = z.infer<typeof proposedChangeSchema>;
export type EventRecord = z.infer<typeof eventRecordSchema>;
export type SavedAppState = z.infer<typeof savedAppStateSchema>;
export type SavedEnvelope = z.infer<typeof savedEnvelopeSchema>;

export type EventType = (typeof EVENT_TYPES)[number];
export type Setting = (typeof SETTINGS)[number];
export type AgeBand = (typeof AGE_BANDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type DietaryNeed = (typeof DIETARY_NEEDS)[number];
export type AccessibilityNeed = (typeof ACCESSIBILITY_NEEDS)[number];
export type ValueOrigin = (typeof VALUE_ORIGINS)[number];
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskKind = (typeof TASK_KINDS)[number];
export type DemoPresetId = (typeof DEMO_PRESET_IDS)[number];

/** `YYYY-MM-DD`, no time zone. */
export type IsoDate = string;

export type CollectionName = (typeof COLLECTION_NAMES)[number];
export interface CollectionItems {
  budgetCategories: BudgetCategory;
  expenses: ExpenseItem;
  tasks: PlanningTask;
  vendors: Vendor;
  guests: GuestRecord;
  ideas: Idea;
  runOrder: RunOrderItem;
}
