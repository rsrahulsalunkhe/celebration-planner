import type {
  AccessibilityNeed,
  AgeBand,
  BudgetCategory,
  DietaryNeed,
  EventProfile,
  EventType,
  ExpenseItem,
  Idea,
  IsoDate,
  PlanningTask,
  Preferences,
  Priority,
  Setting,
  TaskCategory,
  TaskKind,
} from '../types.ts';
import type {
  IDEA_KINDS,
  IMPORTANCES,
  REQUIREMENTS,
  VENDOR_KINDS,
} from '../primitives.ts';

// ---------------------------------------------------------------------------
// Configuration: typed rule data. Content lives in `src/data/planning`.
// ---------------------------------------------------------------------------

export type Importance = (typeof IMPORTANCES)[number];
export type { TaskKind };
/** An accessibility need, or `dietary`. */
export type Requirement = (typeof REQUIREMENTS)[number];
export type VendorKind = (typeof VENDOR_KINDS)[number];
export type IdeaKind = (typeof IDEA_KINDS)[number];

/** What a rule needs to know about the event. Nothing else is consulted. */
export interface PlanningContext {
  profile: EventProfile;
  preferences: Preferences;
}

/** When a template applies. Everything is checked against stated facts only. */
export type Condition =
  | { kind: 'setting'; anyOf: readonly Setting[] }
  /** Omit `anyOf` to mean "any accessibility need at all". */
  | { kind: 'accessibility'; anyOf?: readonly AccessibilityNeed[] }
  /** Omit `anyOf` to mean "any dietary need at all". */
  | { kind: 'dietary'; anyOf?: readonly DietaryNeed[] }
  | { kind: 'priority'; anyOf: readonly Priority[] }
  | { kind: 'ageBand'; anyOf: readonly AgeBand[] }
  | { kind: 'guests'; min?: number; max?: number }
  | { kind: 'any'; of: readonly Condition[] }
  | { kind: 'all'; of: readonly Condition[] }
  | { kind: 'not'; of: Condition };

export type CostRate =
  { basis: 'fixed'; amountPaise: number } | { basis: 'per-guest'; perGuestPaise: number };

export interface CategoryTemplate {
  /** Permanent id, e.g. `category.venue`. Never rename. */
  id: string;
  name: string;
  /** Relative weight (positive integer). Normalized across the categories that apply. */
  weight: number;
  /** User priorities that raise this category's weight. */
  priorities: readonly Priority[];
  rationale: string;
}

export interface ExpenseTemplate {
  id: string;
  categoryId: string;
  name: string;
  /** Fictional illustrative rate; see the configuration's `ratesDisclosure`. */
  rate: CostRate;
  when?: Condition;
  /** Marks a provision that must not be cut to save money. */
  requirement?: Requirement;
  /** May be offered for trimming when funds are short. */
  optional?: boolean;
  rationale: string;
}

export type TaskTiming =
  /** A preparation step due this many days before the event. */
  | { kind: 'before'; days: number }
  /** Something done on the event day itself. */
  | { kind: 'on-day' }
  /** An explicit follow-up that happens this many days after the event. */
  | { kind: 'after'; days: number };

export interface TaskTemplate {
  id: string;
  title: string;
  timing: TaskTiming;
  importance: Importance;
  category: TaskCategory;
  /** Template ids that must be done first. */
  dependsOn: readonly string[];
  when?: Condition;
  rationale: string;
}

export interface ChecklistItem {
  /** May use `{guests}`, `{city}` and `{date}`. */
  text: string;
  when?: Condition;
}

export interface VendorChecklistTemplate {
  id: string;
  vendorKind: VendorKind;
  title: string;
  items: readonly ChecklistItem[];
  when?: Condition;
}

export interface IdeaTagDefinition {
  tag: string;
  label: string;
}

export type EffortLevel = 'low' | 'medium' | 'high';
export type BudgetLevel = 'low' | 'medium' | 'high';

/** What the Ideas workspace filters and explains with. Stated, not inferred. */
export interface IdeaFacets {
  effort: EffortLevel;
  /** Days of preparation the idea usually needs before the event. */
  leadDays: number;
  /** Rough spending level when it is carried out simply. */
  budget: BudgetLevel;
  /** Settings it works in. */
  settings: readonly Setting[];
  /** Suits only these age bands of the guest of honour; absent means any. */
  ageBands?: readonly AgeBand[];
  /** For food ideas: the dietary needs it can meet when prepared that way. */
  suitsDiets?: readonly DietaryNeed[];
  /** Accessibility needs it helps with. */
  helps?: readonly AccessibilityNeed[];
  /** Accessibility needs it is a poor fit for. */
  poorFor?: readonly AccessibilityNeed[];
  /** User priorities it serves. */
  priorities: readonly Priority[];
  /** Expense template (same event type) whose illustrative rate covers it. */
  costFrom?: string;
  /** The one task "Add as a task" creates. */
  task: { title: string; leadDays: number };
  /** Why it is worth doing, in one sentence. */
  why: string;
}

export interface IdeaTemplate {
  id: string;
  title: string;
  details: string;
  kind: IdeaKind;
  tags: readonly string[];
  when?: Condition;
  facets: IdeaFacets;
}

export interface EventTypeConfiguration {
  eventType: EventType;
  label: string;
  /**
   * Days before the event at which the earliest default step falls due. A
   * shorter window triggers a compressed schedule.
   */
  planningHorizonDays: number;
  /** Why the defaults look the way they do. */
  reasoning: string;
  categories: readonly CategoryTemplate[];
  expenses: readonly ExpenseTemplate[];
  tasks: readonly TaskTemplate[];
  vendorChecklists: readonly VendorChecklistTemplate[];
  ideaTags: readonly IdeaTagDefinition[];
  ideas: readonly IdeaTemplate[];
  /** Used only for entries the user typed under cultural preferences. */
  culturalPractice: {
    /** Days before the event for the planning task. */
    leadDays: number;
    taskRationale: string;
    ideaDetails: string;
  };
}

export interface PlanningConfiguration {
  version: string;
  /** Shown wherever a rate or cost appears. */
  ratesDisclosure: string;
  /** Extra weight, in percent, for each matching user priority. */
  priorityBoostPercent: number;
  /** Upper limit on the total boost for one category. */
  maxPriorityBoostPercent: number;
  types: Record<EventType, EventTypeConfiguration>;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface AllocationCategoryInput {
  id: string;
  /** Positive integer relative weight. */
  weight: number;
  /** Minimum target, e.g. the cost of required provisions. */
  floorPaise?: number;
  /** An explicit user target that the allocator must not change. */
  lockedPaise?: number;
}

export interface AllocationTarget {
  id: string;
  targetPaise: number;
  source: 'locked' | 'weighted';
  floorPaise: number;
  weight: number;
  /** Normalized share of the weighted pool, in basis points (10000 = 100%). */
  shareBasisPoints: number;
}

export type AllocationProblemKind =
  'locked-exceeds-spendable' | 'floors-exceed-spendable' | 'nothing-to-receive-remainder';

export interface AllocationProblem {
  kind: AllocationProblemKind;
  amountPaise: number;
  message: string;
}

export interface AllocationResult {
  budgetPaise: number;
  reserveBasisPoints: number;
  reservePaise: number;
  /** Budget minus reserve: the amount spending targets may add up to. */
  spendablePaise: number;
  targets: AllocationTarget[];
  lockedPaise: number;
  /** Money not given to any category. Zero when `balanced`. */
  unallocatedPaise: number;
  /** True when targets plus reserve equal the budget exactly. */
  balanced: boolean;
  problems: AllocationProblem[];
}

export interface ExpenseForecast {
  expenseId: string;
  name: string;
  categoryId: string;
  /** What the plan expects this item to cost at the current guest count. */
  forecastPaise: number;
  basis: 'estimate' | 'commitment';
  /** Present when an agreement exists. */
  committedPaise: number | null;
  depositPaise: number | null;
  paidPaise: number;
  /** Committed minus paid, never negative. The deposit is part of this, not extra. */
  outstandingPaise: number;
  overpaidPaise: number;
}

export interface CategoryForecast {
  categoryId: string;
  forecastPaise: number;
  committedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
}

export interface Forecast {
  guestCount: number;
  items: ExpenseForecast[];
  categories: CategoryForecast[];
  /** Everything the plan expects to spend. Independent of the targets. */
  forecastPaise: number;
  /** Total of agreed amounts. */
  committedPaise: number;
  /** Forecast of items with no agreement yet. */
  uncommittedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  /** `forecast = fixedPaise + perGuestPaise * guestCount`. */
  fixedPaise: number;
  perGuestPaise: number;
}

export type ConflictSeverity = 'blocking' | 'critical' | 'warning' | 'info';

export type ConflictKind =
  | 'forecast-exceeds-budget'
  | 'forecast-uses-reserve'
  | 'commitments-exceed-budget'
  | 'targets-exceed-spendable'
  | 'locked-targets-exceed-spendable'
  | 'required-floors-exceed-spendable'
  | 'category-over-target'
  | 'targets-unallocated'
  | 'payments-without-commitment'
  | 'paid-exceeds-commitment'
  | 'required-provision-removed'
  | 'event-date-in-past'
  | 'event-in-history';

export interface Conflict {
  /** Stable: kind plus subject, so the same problem has the same id each time. */
  id: string;
  kind: ConflictKind;
  severity: ConflictSeverity;
  message: string;
  amountPaise?: number;
  subjectIds?: string[];
}

export type FeasibilityOptionKind =
  'reduce-guests' | 'use-reserve' | 'raise-budget' | 'drop-optional';

export interface FeasibilityOption {
  id: string;
  kind: FeasibilityOptionKind;
  description: string;
  /** How far forecast would still exceed the budget after this option. */
  afterShortfallPaise: number;
  /** How far forecast would still exceed spendable (budget minus reserve). */
  afterGapPaise: number;
  guestCount?: number;
  budgetPaise?: number;
  savingsPaise?: number;
  expenseIds?: string[];
}

export type Urgency = 'done' | 'overdue' | 'due-today' | 'due-soon' | 'upcoming';

export interface ScheduleSummary {
  daysUntilEvent: number;
  /** Tasks whose usual deadline has already passed. */
  behindCount: number;
  compressed: boolean;
  explanation: string;
}

export interface Recommendation {
  id: string;
  kind: string;
  title: string;
  detail: string;
  /** The event facts this recommendation is based on, in plain words. */
  because: string[];
  taskIds?: string[];
}

export interface VendorChecklist {
  id: string;
  vendorKind: VendorKind;
  title: string;
  items: string[];
}

export type PlanStatus = 'upcoming' | 'event-day' | 'history';

export interface GeneratedPlan {
  status: PlanStatus;
  eventId: string;
  eventType: EventType;
  today: IsoDate;
  daysUntilEvent: number;
  reserve: {
    basisPoints: number;
    paise: number;
    isDefault: boolean;
    explanation: string;
  };
  allocation: AllocationResult;
  budgetCategories: BudgetCategory[];
  expenses: ExpenseItem[];
  tasks: PlanningTask[];
  ideas: Idea[];
  vendorChecklists: VendorChecklist[];
  forecast: Forecast;
  conflicts: Conflict[];
  options: FeasibilityOption[];
  schedule: ScheduleSummary;
  recommendations: Recommendation[];
  /** Disclosures, e.g. that rates are fictional. */
  notes: string[];
}
