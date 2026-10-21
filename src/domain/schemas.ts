import { z } from 'zod';
import {
  ACCESSIBILITY_NEEDS,
  AGE_BANDS,
  DEMO_PRESET_IDS,
  DIETARY_NEEDS,
  EVENT_TYPES,
  IDEA_KINDS,
  IDEA_SOURCES,
  IDEA_STATUSES,
  LIMITS,
  PRIORITIES,
  RSVP_STATUSES,
  SETTINGS,
  TASK_STATUSES,
  VALUE_ORIGINS,
  VENDOR_KINDS,
  VENDOR_STATUSES,
  boundedInt,
  idSchema,
  isoDateSchema,
  multiLine,
  paiseSchema,
  positivePaiseSchema,
  singleLine,
  templateIdSchema,
  uniqueArray,
} from './primitives.ts';

export const CURRENT_SCHEMA_VERSION = 1;

export const eventTypeSchema = z.enum(EVENT_TYPES);
export const settingSchema = z.enum(SETTINGS);
export const ageBandSchema = z.enum(AGE_BANDS);
export const valueOriginSchema = z.enum(VALUE_ORIGINS);
const dietaryNeedSchema = z.enum(DIETARY_NEEDS);
const accessibilityNeedSchema = z.enum(ACCESSIBILITY_NEEDS);

// ---------------------------------------------------------------------------
// EventProfile and Preferences
// ---------------------------------------------------------------------------

/** Plain object (no refinements) so patch schemas can be derived from it. */
export const eventProfileShape = z.object({
  id: idSchema,
  /** Increases by one on every accepted edit; used to detect stale proposals. */
  revision: boundedInt('Revision', 0, Number.MAX_SAFE_INTEGER),
  title: singleLine('Title', 100),
  eventType: eventTypeSchema,
  date: isoDateSchema,
  city: singleLine('City', 80),
  guestCount: boundedInt('Guest count', 1, LIMITS.guestCount),
  /** Total budget in paise. Must be positive; zero is not a default. */
  budgetPaise: z
    .number({ error: 'Budget must be a number' })
    .int('Budget must be a whole number of paise')
    .min(1, 'Budget must be greater than zero')
    .max(LIMITS.maxMoneyPaise, 'Budget is too large'),
  setting: settingSchema,
  /** Birthdays only. A band, never an exact birth date. */
  ageBand: ageBandSchema.optional(),
  /** Present only on events created from a fictional demonstration preset. */
  demoPresetId: z.enum(DEMO_PRESET_IDS).optional(),
});

export const eventProfileSchema = eventProfileShape.refine(
  (p) => p.ageBand === undefined || p.eventType === 'birthday',
  { path: ['ageBand'], error: 'Age band applies to birthdays only' },
);

export const preferencesSchema = z.object({
  priorities: uniqueArray(z.enum(PRIORITIES), LIMITS.priorities),
  dietaryNeeds: uniqueArray(dietaryNeedSchema, DIETARY_NEEDS.length),
  dietaryNotes: multiLine('Dietary notes', 300).optional(),
  accessibilityNeeds: uniqueArray(accessibilityNeedSchema, ACCESSIBILITY_NEEDS.length),
  accessibilityNotes: multiLine('Accessibility notes', 300).optional(),
  /** Free text supplied by the user. Never inferred from names or location. */
  culturalPreferences: z
    .array(singleLine('Cultural preference', 60))
    .max(LIMITS.culturalPreferences, `At most ${LIMITS.culturalPreferences} items`),
});

// ---------------------------------------------------------------------------
// Budget: planned allocation, estimate, commitment and payments are separate.
// ---------------------------------------------------------------------------

export const budgetCategorySchema = z.object({
  id: idSchema,
  /** Set when generated from a template; stable across regeneration. */
  templateId: templateIdSchema.optional(),
  name: singleLine('Category name', 60),
  /** Money set aside for this category. */
  plannedPaise: paiseSchema,
  plannedOrigin: valueOriginSchema,
  rationale: multiLine('Rationale', 300).optional(),
});

export const paymentSchema = z.object({
  id: idSchema,
  amountPaise: positivePaiseSchema,
  date: isoDateSchema,
  note: multiLine('Note', 100).optional(),
});

export const expenseItemSchema = z.object({
  id: idSchema,
  templateId: templateIdSchema.optional(),
  categoryId: idSchema,
  vendorId: idSchema.optional(),
  name: singleLine('Expense name', 100),
  /** What the item is expected to cost. */
  estimatePaise: paiseSchema,
  estimateOrigin: valueOriginSchema,
  /** Agreed amount once quoted and accepted; `null` means not committed yet. */
  committedPaise: paiseSchema.nullable(),
  /** Money actually paid, as dated entries. The paid total is derived. */
  payments: z.array(paymentSchema).max(LIMITS.paymentsPerExpense),
  notes: multiLine('Notes', 500).optional(),
});

// ---------------------------------------------------------------------------
// Plan, people and ideas
// ---------------------------------------------------------------------------

export const planningTaskSchema = z.object({
  id: idSchema,
  templateId: templateIdSchema.optional(),
  title: singleLine('Task title', 120),
  dueDate: isoDateSchema,
  dueDateOrigin: valueOriginSchema,
  status: z.enum(TASK_STATUSES),
  vendorId: idSchema.optional(),
  /** Why the planner suggests this task. */
  rationale: multiLine('Rationale', 300).optional(),
  notes: multiLine('Notes', 500).optional(),
});

export const vendorSchema = z.object({
  id: idSchema,
  name: singleLine('Vendor name', 100),
  kind: z.enum(VENDOR_KINDS),
  status: z.enum(VENDOR_STATUSES),
  contact: singleLine('Contact', 120).optional(),
  /** Latest quote; `null` means no quote yet. */
  quotePaise: paiseSchema.nullable(),
  notes: multiLine('Notes', 500).optional(),
});

export const guestRecordSchema = z.object({
  id: idSchema,
  name: singleLine('Guest name', 80),
  partySize: boundedInt('Party size', 1, LIMITS.partySize),
  rsvp: z.enum(RSVP_STATUSES),
  dietaryNeeds: uniqueArray(dietaryNeedSchema, DIETARY_NEEDS.length),
  accessibilityNeeds: uniqueArray(accessibilityNeedSchema, ACCESSIBILITY_NEEDS.length),
  notes: multiLine('Notes', 200).optional(),
});

export const ideaSchema = z.object({
  id: idSchema,
  templateId: templateIdSchema.optional(),
  title: singleLine('Idea title', 100),
  details: multiLine('Details', 500).optional(),
  kind: z.enum(IDEA_KINDS),
  status: z.enum(IDEA_STATUSES),
  source: z.enum(IDEA_SOURCES),
});

// ---------------------------------------------------------------------------
// Proposed changes and assistant messages (session-only, never persisted)
// ---------------------------------------------------------------------------

const profilePatchSchema = eventProfileShape
  .omit({ id: true, revision: true, ageBand: true, demoPresetId: true })
  .partial()
  .extend({
    /** `null` clears the age band. */
    ageBand: ageBandSchema.nullable().optional(),
  });

const upsertOp = <K extends string, S extends z.ZodType>(collection: K, item: S) =>
  z.object({ op: z.literal(`${collection}/upsert`), item });
const removeOp = <K extends string>(collection: K) =>
  z.object({ op: z.literal(`${collection}/remove`), itemId: idSchema });

export const changeOperationSchema = z.union([
  z.object({ op: z.literal('profile/patch'), patch: profilePatchSchema }),
  z.object({ op: z.literal('preferences/set'), preferences: preferencesSchema }),
  upsertOp('budgetCategories', budgetCategorySchema),
  removeOp('budgetCategories'),
  upsertOp('expenses', expenseItemSchema),
  removeOp('expenses'),
  upsertOp('tasks', planningTaskSchema),
  removeOp('tasks'),
  upsertOp('vendors', vendorSchema),
  removeOp('vendors'),
  upsertOp('guests', guestRecordSchema),
  removeOp('guests'),
  upsertOp('ideas', ideaSchema),
  removeOp('ideas'),
]);

export const proposedChangeSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  /** Event revision this proposal was computed against. */
  baseRevision: boundedInt('Revision', 0, Number.MAX_SAFE_INTEGER),
  source: z.enum(['rules', 'assistant']),
  summary: singleLine('Summary', 200),
  rationale: singleLine('Rationale', 600),
  operations: z.array(changeOperationSchema).min(1).max(LIMITS.operationsPerChange),
  status: z.enum(['pending', 'accepted', 'rejected', 'stale']),
});

export const assistantMessageSchema = z.object({
  id: idSchema,
  role: z.enum(['user', 'assistant']),
  content: singleLine('Message', 4000),
  proposedChangeId: idSchema.optional(),
});

// ---------------------------------------------------------------------------
// Saved state
// ---------------------------------------------------------------------------

/** Names of the per-event collections, in a fixed order. */
export const COLLECTION_NAMES = [
  'budgetCategories',
  'expenses',
  'tasks',
  'vendors',
  'guests',
  'ideas',
] as const;

function checkEventIntegrity(
  record: {
    budgetCategories: { id: string; templateId?: string | undefined }[];
    expenses: {
      id: string;
      templateId?: string | undefined;
      categoryId: string;
      vendorId?: string | undefined;
      payments: { id: string }[];
    }[];
    tasks: {
      id: string;
      templateId?: string | undefined;
      vendorId?: string | undefined;
    }[];
    vendors: { id: string }[];
    guests: { id: string }[];
    ideas: { id: string; templateId?: string | undefined }[];
  },
  ctx: z.RefinementCtx,
): void {
  const fail = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  for (const name of COLLECTION_NAMES) {
    const ids = new Set<string>();
    const templates = new Set<string>();
    const items: { id: string; templateId?: string | undefined }[] = record[name];
    items.forEach((item, index) => {
      if (ids.has(item.id)) fail([name, index, 'id'], 'Duplicate id');
      ids.add(item.id);
      if (item.templateId !== undefined) {
        if (templates.has(item.templateId)) {
          fail([name, index, 'templateId'], 'Duplicate template');
        }
        templates.add(item.templateId);
      }
    });
  }
  const categoryIds = new Set(record.budgetCategories.map((c) => c.id));
  const vendorIds = new Set(record.vendors.map((v) => v.id));
  record.expenses.forEach((expense, index) => {
    if (!categoryIds.has(expense.categoryId)) {
      fail(['expenses', index, 'categoryId'], 'Unknown budget category');
    }
    if (expense.vendorId !== undefined && !vendorIds.has(expense.vendorId)) {
      fail(['expenses', index, 'vendorId'], 'Unknown vendor');
    }
    const paymentIds = new Set(expense.payments.map((p) => p.id));
    if (paymentIds.size !== expense.payments.length) {
      fail(['expenses', index, 'payments'], 'Duplicate payment id');
    }
  });
  record.tasks.forEach((task, index) => {
    if (task.vendorId !== undefined && !vendorIds.has(task.vendorId)) {
      fail(['tasks', index, 'vendorId'], 'Unknown vendor');
    }
  });
}

/**
 * Everything saved for one event. Totals, percentages and filtered lists are
 * deliberately absent: they are derived by selectors.
 */
export const eventRecordSchema = z
  .object({
    profile: eventProfileSchema,
    preferences: preferencesSchema,
    budgetCategories: z.array(budgetCategorySchema).max(LIMITS.budgetCategories),
    expenses: z.array(expenseItemSchema).max(LIMITS.expenses),
    tasks: z.array(planningTaskSchema).max(LIMITS.tasks),
    vendors: z.array(vendorSchema).max(LIMITS.vendors),
    guests: z.array(guestRecordSchema).max(LIMITS.guests),
    ideas: z.array(ideaSchema).max(LIMITS.ideas),
  })
  .superRefine(checkEventIntegrity);

export const savedAppStateSchema = z
  .object({
    activeEventId: idSchema.nullable(),
    events: z.array(eventRecordSchema).max(LIMITS.events),
  })
  .superRefine((state, ctx) => {
    const ids = new Set<string>();
    state.events.forEach((event, index) => {
      if (ids.has(event.profile.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'profile', 'id'],
          message: 'Duplicate event id',
        });
      }
      ids.add(event.profile.id);
    });
    if (state.activeEventId !== null && !ids.has(state.activeEventId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['activeEventId'],
        message: 'Active event does not exist',
      });
    }
  });

/** Versioned wrapper written to localStorage and to JSON exports. */
export const savedEnvelopeSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  data: savedAppStateSchema,
});
