import { addDays, daysBetween, formatDate } from '../dates.ts';
import { generatedId } from '../ids.ts';
import { formatMoney } from '../money.ts';
import type {
  ChangeOperation,
  EventRecord,
  EventType,
  Idea,
  IsoDate,
  PlanningTask,
  Priority,
  TaskCategory,
} from '../types.ts';
import { fillTokens } from './conditions.ts';
import { estimateTotal } from './forecast.ts';
import type {
  BudgetLevel,
  EffortLevel,
  IdeaTemplate,
  PlanningConfiguration,
} from './types.ts';

/**
 * The Ideas workspace: deterministic suggestions from the planning rules,
 * filtered by the event's stated facts and the organizer's choices, plus the
 * ideas the organizer saved (guided suggestions, Local AI drafts and their
 * own). Nothing here touches the budget: an illustrative cost is shown only
 * when a configured expense rate backs it, and is never added as an expense.
 */

export type IdeaSource = 'guided' | 'local-ai' | 'user';

export const SOURCE_LABELS: Record<IdeaSource, string> = {
  guided: 'Guided suggestion',
  'local-ai': 'Local AI draft',
  user: 'User idea',
};

export function sourceOf(idea: Pick<Idea, 'source'>): IdeaSource {
  if (idea.source === 'assistant') return 'local-ai';
  return idea.source === 'user' ? 'user' : 'guided';
}

export type BudgetFilter = 'any' | 'low' | 'medium';

export interface IdeaFilters {
  eventType: EventType;
  /** Only ideas that can be prepared in the days left. */
  fitTime: boolean;
  /** Highest budget level to show. */
  budget: BudgetFilter;
  /** `event`: only ideas that work in the event's setting. */
  setting: 'event' | 'any';
  /** Only ideas suited to the guest of honour's age band, when one is set. */
  ageBand: boolean;
  /** Only food ideas shown to suit every stated dietary need. */
  diet: boolean;
  /** Leave out ideas that are a poor fit for a stated accessibility need. */
  access: boolean;
  /** When not empty, only ideas serving at least one of these. */
  preferences: Priority[];
}

export function defaultIdeaFilters(record: EventRecord): IdeaFilters {
  return {
    eventType: record.profile.eventType,
    fitTime: true,
    budget: 'any',
    setting: 'event',
    ageBand: true,
    diet: true,
    access: true,
    preferences: [],
  };
}

export interface CostNote {
  expenseName: string;
  paise: number;
  text: string;
}

export interface Suggestion {
  templateId: string;
  eventType: EventType;
  title: string;
  details: string;
  kind: Idea['kind'];
  tags: string[];
  effort: EffortLevel;
  leadDays: number;
  budget: BudgetLevel;
  /** Why it fits this event, in plain words. */
  reasons: string[];
  cost: CostNote | null;
  /** The organizer's saved copy, if any. */
  saved: Idea | null;
  template: IdeaTemplate;
}

export interface HiddenSuggestion {
  templateId: string;
  title: string;
  /** Why it is not shown. */
  reasons: string[];
}

export interface SuggestionResult {
  shown: Suggestion[];
  hidden: HiddenSuggestion[];
  daysUntilEvent: number;
}

const BUDGET_ORDER: Record<BudgetLevel, number> = { low: 0, medium: 1, high: 2 };
const EFFORT_ORDER: Record<EffortLevel, number> = { low: 0, medium: 1, high: 2 };
const words = (s: string) => s.replaceAll('-', ' ');
const list = (items: readonly string[]) => items.map(words).join(', ');

export function costNote(
  template: IdeaTemplate,
  eventType: EventType,
  guestCount: number,
  configuration: PlanningConfiguration,
): CostNote | null {
  const ref = template.facets.costFrom;
  if (!ref) return null;
  const expense = configuration.types[eventType].expenses.find((e) => e.id === ref);
  if (!expense) return null;
  const paise = estimateTotal(expense.rate, guestCount);
  return {
    expenseName: expense.name,
    paise,
    text: `Covered by the planner’s illustrative “${expense.name}” estimate of ${formatMoney(paise)}${expense.rate.basis === 'per-guest' ? ` (${formatMoney(expense.rate.perGuestPaise)} per guest × ${guestCount})` : ''}. Nothing is added to your budget.`,
  };
}

/**
 * Suggestions for the chosen event type, each with the reasons it fits, and
 * the ones left out with the reasons why. Ranked by matching priorities,
 * then lower effort, then shorter preparation, then title.
 */
export function suggestIdeas(
  record: EventRecord,
  today: IsoDate,
  configuration: PlanningConfiguration,
  filters: IdeaFilters,
): SuggestionResult {
  const { profile, preferences } = record;
  const daysUntilEvent = daysBetween(today, profile.date);
  const ctx = { profile, preferences };
  const templates = configuration.types[filters.eventType].ideas;
  const wanted =
    filters.preferences.length > 0 ? filters.preferences : preferences.priorities;
  const shown: (Suggestion & { score: number })[] = [];
  const hidden: HiddenSuggestion[] = [];

  for (const template of templates) {
    const f = template.facets;
    const reasons: string[] = [];
    const excluded: string[] = [];

    if (filters.eventType !== profile.eventType) {
      reasons.push(
        `Written for a ${filters.eventType}; your event is a ${profile.eventType}.`,
      );
    }

    if (filters.fitTime) {
      if (daysUntilEvent < 0) excluded.push('The event has passed.');
      else if (f.leadDays > daysUntilEvent) {
        excluded.push(
          `Needs about ${f.leadDays} days of preparation; only ${daysUntilEvent} ${daysUntilEvent === 1 ? 'day is' : 'days are'} left.`,
        );
      } else {
        reasons.push(
          `Needs about ${f.leadDays} days of preparation; you have ${daysUntilEvent}.`,
        );
      }
    }

    const cost = costNote(template, filters.eventType, profile.guestCount, configuration);
    if (
      filters.budget !== 'any' &&
      BUDGET_ORDER[f.budget] > BUDGET_ORDER[filters.budget]
    ) {
      excluded.push(
        `Its cost level is ${f.budget}, above the ${filters.budget} level you chose.`,
      );
    } else if (f.budget === 'low') {
      reasons.push('Low cost when kept simple.');
    }

    if (filters.setting === 'event') {
      const fits =
        profile.setting === 'mixed'
          ? f.settings.length > 0
          : f.settings.includes(profile.setting);
      if (!fits)
        excluded.push(
          `Works ${list(f.settings)} only; your event is ${profile.setting}.`,
        );
      else if (f.settings.length === 1)
        reasons.push(`Made for ${f.settings[0]} settings, like yours.`);
    }

    if (filters.ageBand && profile.ageBand && f.ageBands) {
      if (!f.ageBands.includes(profile.ageBand)) {
        excluded.push(
          `Suits guests of honour aged ${list(f.ageBands)}, not ${words(profile.ageBand)}.`,
        );
      } else {
        reasons.push(`Suits a guest of honour aged ${words(profile.ageBand)}.`);
      }
    }

    if (template.kind === 'food' && preferences.dietaryNeeds.length > 0) {
      const suits = f.suitsDiets ?? [];
      const missing = preferences.dietaryNeeds.filter((d) => !suits.includes(d));
      if (missing.length > 0) {
        if (filters.diet) excluded.push(`Not shown to suit ${list(missing)}.`);
        else
          reasons.push(
            `Check it for ${list(missing)}: the planner has not shown it suits them.`,
          );
      } else {
        reasons.push(`Can suit ${list(preferences.dietaryNeeds)}.`);
      }
    }

    const needs = preferences.accessibilityNeeds;
    const poor = (f.poorFor ?? []).filter((n) => needs.includes(n));
    if (poor.length > 0) {
      if (filters.access)
        excluded.push(`A poor fit for ${list(poor)}, which you listed.`);
      else reasons.push(`Check it for ${list(poor)}: it is usually a poor fit.`);
    }
    const helps = (f.helps ?? []).filter((n) => needs.includes(n));
    if (helps.length > 0) reasons.push(`Helps with ${list(helps)}, which you listed.`);

    const matched = f.priorities.filter((p) => wanted.includes(p));
    if (filters.preferences.length > 0 && matched.length === 0) {
      excluded.push(
        `Not linked to the preferences you picked (${list(filters.preferences)}).`,
      );
    } else if (matched.length > 0) {
      reasons.push(
        `Serves your ${list(matched)} ${matched.length === 1 ? 'preference' : 'preferences'}.`,
      );
    }

    if (excluded.length > 0) {
      hidden.push({ templateId: template.id, title: template.title, reasons: excluded });
      continue;
    }
    const saved =
      filters.eventType === profile.eventType
        ? (record.ideas.find((i) => i.templateId === template.id) ?? null)
        : null;
    shown.push({
      templateId: template.id,
      eventType: filters.eventType,
      title: template.title,
      details: fillTokens(template.details, ctx),
      kind: template.kind,
      tags: [...template.tags],
      effort: f.effort,
      leadDays: f.leadDays,
      budget: f.budget,
      reasons: [f.why, ...reasons],
      cost,
      saved,
      template,
      score: matched.length,
    });
  }

  shown.sort(
    (a, b) =>
      b.score - a.score ||
      EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort] ||
      a.leadDays - b.leadDays ||
      a.title.localeCompare(b.title),
  );
  return {
    shown: shown.map(({ score: _score, ...s }) => s),
    hidden,
    daysUntilEvent,
  };
}

// ---------------------------------------------------------------------------
// Saving, favouriting and the one linked task
// ---------------------------------------------------------------------------

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** A guided suggestion as a saved idea. Its id is stable, so saving twice changes one record. */
export function ideaFromSuggestion(
  record: EventRecord,
  suggestion: Suggestion,
  favorite: boolean,
): Idea {
  const existing = suggestion.saved;
  return {
    ...(existing ?? {}),
    id: existing?.id ?? generatedId(record.profile.id, suggestion.templateId),
    templateId: suggestion.templateId,
    title: clip(suggestion.title, 100),
    details: clip(suggestion.details, 500),
    kind: suggestion.kind,
    tags: suggestion.tags.slice(0, 6),
    status: 'saved',
    source: 'built-in',
    favorite,
    reason: clip(suggestion.template.facets.why, 300),
  };
}

/** Saves a Local AI draft item as an idea, marked as the model's draft. */
export function ideaFromDraft(
  item: { title: string; details: string },
  id: string,
  today: IsoDate,
): Idea {
  return {
    id,
    title: clip(item.title.trim(), 100),
    details: clip(item.details.trim(), 500),
    kind: 'theme',
    status: 'saved',
    source: 'assistant',
    favorite: false,
    reason: `Drafted by Local AI on ${formatDate(today)}. An unchecked draft: review it before using it.`,
  };
}

/** Whether a draft with the same title is already saved, so it is not saved twice. */
export function draftAlreadySaved(record: EventRecord, title: string): Idea | null {
  const key = title.trim().toLocaleLowerCase('en-IN');
  return (
    record.ideas.find(
      (i) =>
        i.source === 'assistant' && i.title.trim().toLocaleLowerCase('en-IN') === key,
    ) ?? null
  );
}

/** The stable id of the task made from an idea. */
export const ideaTaskId = (ideaId: string): string => `${ideaId}~task`;

const CATEGORY_FOR_KIND: Record<Idea['kind'], TaskCategory> = {
  theme: 'celebration',
  activity: 'celebration',
  decor: 'celebration',
  food: 'food',
  favour: 'celebration',
};

export type IdeaTaskResult =
  | { ok: true; operations: ChangeOperation[]; task: PlanningTask; created: boolean }
  | { ok: false; reason: string };

/**
 * Turns an idea into one preparation task. The task id is derived from the
 * idea id, so asking again finds the same task instead of adding another.
 * Saves the idea too, linked to the task. Never adds an expense.
 */
export function ideaTaskOperations(
  record: EventRecord,
  idea: Idea,
  plan: { title: string; leadDays: number; why?: string },
  today: IsoDate,
): IdeaTaskResult {
  const eventDate = record.profile.date;
  const taskId = ideaTaskId(idea.id);
  const existing = record.tasks.find((t) => t.id === taskId);
  const linkedIdea: Idea = { ...idea, status: 'saved', taskId };
  if (existing) {
    const current = record.ideas.find((i) => i.id === idea.id);
    const needsLink = current?.taskId !== taskId || current.status !== 'saved';
    return {
      ok: true,
      operations: needsLink
        ? [
            {
              op: 'ideas/upsert',
              item: { ...(current ?? idea), status: 'saved', taskId },
            },
          ]
        : [],
      task: existing,
      created: false,
    };
  }
  if (daysBetween(today, eventDate) < 0) {
    return {
      ok: false,
      reason: 'This event has passed, so no new preparation task is added.',
    };
  }
  const ideal = addDays(eventDate, -plan.leadDays);
  const dueDate = ideal < today ? today : ideal;
  const task: PlanningTask = {
    id: taskId,
    title: clip(plan.title, 120),
    dueDate,
    dueDateOrigin: 'user',
    dueDateSetFor: eventDate,
    status: 'todo',
    kind: 'preparation',
    category: CATEGORY_FOR_KIND[idea.kind],
    importance: 'routine',
    rationale: clip(
      `From the idea “${idea.title}”.${plan.why ? ` ${plan.why}` : ''} Usually done ${plan.leadDays} days before the event${ideal < today ? `; that date has passed, so it is due today` : ''}.`,
      600,
    ),
  };
  return {
    ok: true,
    operations: [
      { op: 'ideas/upsert', item: linkedIdea },
      { op: 'tasks/upsert', item: task },
    ],
    task,
    created: true,
  };
}

/** The task plan for an idea: its configured task, or a plain one for drafts and user ideas. */
export function taskPlanFor(
  idea: Idea,
  configuration: PlanningConfiguration,
  eventType: EventType,
): { title: string; leadDays: number; why?: string } {
  const template = idea.templateId
    ? configuration.types[eventType].ideas.find((t) => t.id === idea.templateId)
    : undefined;
  if (template) {
    return {
      title: template.facets.task.title,
      leadDays: template.facets.task.leadDays,
      why: template.facets.why,
    };
  }
  return { title: `Prepare: ${idea.title}`, leadDays: 14 };
}
