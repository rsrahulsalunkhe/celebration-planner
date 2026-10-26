import { z } from 'zod';
import {
  LIMITS,
  MAX_RESERVE_BASIS_POINTS,
  boundedInt,
  positivePaiseSchema,
} from '@/domain/primitives.ts';
import { settingSchema } from '@/domain/schemas.ts';
import type {
  AccessibilityNeed,
  AgeBand,
  DietaryNeed,
  EventType,
  IsoDate,
  Priority,
  Setting,
} from '@/domain/types.ts';

/**
 * The contract between the planner and any assistant. A provider sees only a
 * bounded snapshot of the active event plus the user's message, and answers
 * with one typed response. It never receives the saved record and never
 * changes anything: a change comes back as a validated intent, which the
 * planner turns into an engine-computed proposal that the user must apply.
 *
 * `GuidedPlannerProvider` implements this with deterministic rules. A local
 * language model could implement the same interface later.
 */

/** Longest message accepted from the user. */
export const MAX_MESSAGE_CHARS = 500;
/** Messages kept per event in one session. Older ones are dropped. */
export const MAX_CONVERSATION_MESSAGES = 40;

export interface ContextSnapshot {
  eventId: string;
  revision: number;
  today: IsoDate;
  event: {
    title: string;
    eventType: EventType;
    date: IsoDate;
    daysUntil: number;
    city: string;
    guestCount: number;
    budgetPaise: number;
    setting: Setting;
    reserveBasisPoints: number;
    reserveIsDefault: boolean;
    ageBand: AgeBand | null;
  };
  preferences: {
    priorities: Priority[];
    dietaryNeeds: DietaryNeed[];
    accessibilityNeeds: AccessibilityNeed[];
  };
  budget: {
    hasBudget: boolean;
    forecastPaise: number;
    committedPaise: number;
    paidPaise: number;
    outstandingPaise: number;
    reservePaise: number;
    spendablePaise: number;
    headroomPaise: number;
    shortfallPaise: number;
    gapPaise: number;
    perGuestPaise: number;
    fixedPaise: number;
    /** Largest categories by forecast, at most five. */
    categories: { name: string; targetPaise: number; forecastPaise: number }[];
  };
  timeline: {
    hasTimeline: boolean;
    open: number;
    done: number;
    overdue: number;
    behind: number;
    overloaded: boolean;
    /** Most pressing open tasks, at most five. */
    next: { title: string; dueDate: IsoDate; urgency: string; blockedBy: string[] }[];
  };
  vendors: { listed: number; booked: number };
  guests: { listedPeople: number; acceptedPeople: number };
  /** Budget and schedule problems in plain words, at most five. */
  concerns: string[];
}

export interface AssistantRequest {
  requestId: string;
  eventId: string;
  revision: number;
  context: ContextSnapshot;
  message: string;
}

/**
 * The only changes an assistant may propose. Payments, deleting events,
 * marking vendors booked and anything else are not representable here.
 */
export const changeIntentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set-guest-count'),
    guestCount: boundedInt('Guest count', 1, LIMITS.guestCount),
  }),
  z.object({ type: z.literal('set-budget'), budgetPaise: positivePaiseSchema }),
  z.object({
    type: z.literal('reduce-budget-percent'),
    percent: boundedInt('Percent', 1, 99),
  }),
  z.object({ type: z.literal('set-setting'), setting: settingSchema }),
  z.object({
    type: z.literal('set-reserve'),
    reserveBasisPoints: boundedInt('Reserve', 0, MAX_RESERVE_BASIS_POINTS),
  }),
]);
export type ChangeIntent = z.infer<typeof changeIntentSchema>;

export interface ProviderInfo {
  id: string;
  /** Shown with every response, e.g. "Guided planner". */
  label: string;
}

/** Present when an AI model wrote the text, rather than the planner's rules or templates. */
export interface GeneratedBy {
  by: 'local-model';
  model: string;
  /** Plain-language warning shown with the text. */
  caution: string;
  /** What the checks changed or noticed. */
  warnings: string[];
}

interface ResponseBase {
  requestId: string;
  eventId: string;
  revision: number;
  provider: ProviderInfo;
  generated?: GeneratedBy;
}

export interface SuggestedReply {
  label: string;
  /** The message sent when chosen. */
  message: string;
}

export interface PageLink {
  label: string;
  /** An in-app route, e.g. `/budget`. */
  to: string;
}

export type AssistantResponse =
  | (ResponseBase & {
      kind: 'question';
      text: string;
      options: SuggestedReply[];
    })
  | (ResponseBase & {
      kind: 'info';
      title: string;
      paragraphs: string[];
      facts?: { label: string; value: string }[];
      links?: PageLink[];
      suggestions?: SuggestedReply[];
    })
  | (ResponseBase & {
      kind: 'draft';
      title: string;
      intro: string;
      items: { title: string; details: string }[];
      note: string;
    })
  | (ResponseBase & {
      kind: 'proposal';
      title: string;
      explanation: string;
      intent: ChangeIntent;
    });

export interface AssistantProvider {
  readonly info: ProviderInfo;
  /** Commands it understands, shown to the user. */
  readonly examples: readonly string[];
  /**
   * Answers one request. `onProgress` may receive a short preview while a
   * model is writing; it is display-only and never announced token by token.
   */
  respond(
    request: AssistantRequest,
    signal?: AbortSignal,
    onProgress?: (preview: string) => void,
  ): Promise<AssistantResponse>;
}
