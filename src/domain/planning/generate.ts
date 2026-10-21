import { daysBetween, formatDate, parseIsoDate } from '../dates.ts';
import { generatedId } from '../ids.ts';
import { formatMoney } from '../money.ts';
import { DEFAULT_RESERVE_BASIS_POINTS } from '../primitives.ts';
import type {
  BudgetCategory,
  EventProfile,
  ExpenseItem,
  Idea,
  IsoDate,
  PlanningTask,
  Preferences,
  TaskCategory,
} from '../types.ts';
import {
  allocateTargets,
  computeReserve,
  effectiveWeight,
  type EffectiveWeight,
} from './allocation.ts';
import { clip, fillTokens, matches } from './conditions.ts';
import { assertValidConfiguration } from './configuration.ts';
import { scheduleTasks, summarizeSchedule, type SchedulableTask } from './deadlines.ts';
import { assessFeasibility } from './feasibility.ts';
import { estimateTotal, forecastExpenses } from './forecast.ts';
import { buildRecommendations } from './recommendations.ts';
import type {
  AllocationCategoryInput,
  AllocationResult,
  Conflict,
  CostRate,
  GeneratedPlan,
  PlanningConfiguration,
  TaskTemplate,
  VendorChecklist,
} from './types.ts';

/**
 * What the generator reads. `budgetCategories` is optional: targets the user
 * set explicitly (origin `user`) are kept as fixed targets and the rest of the
 * spendable budget is shared around them.
 */
export interface PlanInput {
  profile: EventProfile;
  preferences: Preferences;
  budgetCategories?: readonly BudgetCategory[];
  /** Existing tasks, so completed steps do not take up catch-up slots. */
  tasks?: readonly PlanningTask[];
}

const pct = (basisPoints: number): string => `${(basisPoints / 100).toString()}%`;

/** Small deterministic hash (FNV-1a) used to name entries that have no usable ASCII slug. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Stable key for a user-typed entry, so the same text always gets the same id. */
export function entryKey(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : `c${hashText(text.toLowerCase())}`;
}

function uniqueEntries(texts: readonly string[]): { key: string; text: string }[] {
  const seen = new Set<string>();
  const entries: { key: string; text: string }[] = [];
  for (const text of texts) {
    const key = entryKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, text });
  }
  return entries;
}

function rateText(rate: CostRate, guests: number): string {
  return rate.basis === 'fixed'
    ? `Fixed ${formatMoney(rate.amountPaise)}.`
    : `${formatMoney(rate.perGuestPaise)} per guest × ${guests} guests = ${formatMoney(rate.perGuestPaise * guests)}.`;
}

const toEstimate = (rate: CostRate): ExpenseItem['estimate'] => rate;

/**
 * Builds a complete plan for one event. Pure: the same inputs always give the
 * same output, `today` is passed in, and nothing reads the clock or randomness.
 *
 * `event` carries the preferences because user priorities, dietary needs and
 * accessibility needs shape the plan along with the profile.
 */
export function generatePlan(
  event: PlanInput,
  configuration: PlanningConfiguration,
  today: IsoDate,
): GeneratedPlan {
  if (!parseIsoDate(today)) throw new RangeError(`Invalid ISO date for today: ${today}`);
  assertValidConfiguration(configuration);

  const { profile, preferences } = event;
  const ctx = { profile, preferences };
  const config = configuration.types[profile.eventType];
  const eventId = profile.id;
  const guests = profile.guestCount;
  const daysUntilEvent = daysBetween(today, profile.date);
  const status =
    daysUntilEvent < 0 ? 'history' : daysUntilEvent === 0 ? 'event-day' : 'upcoming';

  const reserveBasisPoints = profile.reserveBasisPoints ?? DEFAULT_RESERVE_BASIS_POINTS;
  const reservePaise = computeReserve(profile.budgetPaise, reserveBasisPoints);
  const spendablePaise = profile.budgetPaise - reservePaise;
  const reserve = {
    basisPoints: reserveBasisPoints,
    paise: reservePaise,
    isDefault: profile.reserveBasisPoints === undefined,
    explanation: `${pct(reserveBasisPoints)} of the ${formatMoney(profile.budgetPaise)} budget (${formatMoney(reservePaise)}) is held back as a contingency reserve${profile.reserveBasisPoints === undefined ? ', the default' : ', as you chose'}. Spending targets share the remaining ${formatMoney(spendablePaise)}.`,
  };
  const notes = [configuration.ratesDisclosure, config.reasoning];

  if (status === 'history') {
    const emptyForecast = forecastExpenses([], guests);
    const allocation: AllocationResult = {
      budgetPaise: profile.budgetPaise,
      reserveBasisPoints,
      reservePaise,
      spendablePaise,
      targets: [],
      lockedPaise: 0,
      unallocatedPaise: spendablePaise,
      balanced: false,
      problems: [],
    };
    return {
      status,
      eventId,
      eventType: profile.eventType,
      today,
      daysUntilEvent,
      reserve,
      allocation,
      budgetCategories: [],
      expenses: [],
      tasks: [],
      ideas: [],
      vendorChecklists: [],
      forecast: emptyForecast,
      conflicts: [
        {
          id: 'conflict.event-in-history',
          kind: 'event-in-history',
          severity: 'info',
          message: `This event was on ${formatDate(profile.date)}, which has passed. It is kept as history and no new plan is generated.`,
        },
      ],
      options: [],
      schedule: {
        daysUntilEvent,
        behindCount: 0,
        compressed: false,
        explanation: 'The event date has passed, so nothing is scheduled.',
      },
      recommendations: [],
      notes,
    };
  }

  // --- Expenses and categories that apply to this event -------------------
  const expenseTemplates = config.expenses.filter((e) => matches(e.when, ctx));
  const categoryTemplates = config.categories.filter((c) =>
    expenseTemplates.some((e) => e.categoryId === c.id),
  );
  const existing = event.budgetCategories ?? [];
  const existingByTemplate = new Map(
    existing.flatMap((c) => (c.templateId ? [[c.templateId, c] as const] : [])),
  );
  const categoryIdFor = (templateId: string): string =>
    existingByTemplate.get(templateId)?.id ?? generatedId(eventId, templateId);

  const expenses: ExpenseItem[] = expenseTemplates.map((t) => ({
    id: generatedId(eventId, t.id),
    templateId: t.id,
    categoryId: categoryIdFor(t.categoryId),
    name: t.name,
    estimate: toEstimate(t.rate),
    estimateOrigin: 'generated',
    commitment: null,
    payments: [],
    ...(t.requirement ? { requirement: t.requirement } : {}),
    ...(t.optional ? { optional: true } : {}),
    rationale: clip(`${rateText(t.rate, guests)} ${t.rationale}`, 400),
  }));

  // --- Targets: reserve off the top, locks and floors, then weights --------
  const effective = new Map<string, EffectiveWeight>();
  const allocationInputs: AllocationCategoryInput[] = categoryTemplates.map((c) => {
    const weight = effectiveWeight(
      c,
      preferences.priorities,
      configuration.priorityBoostPercent,
      configuration.maxPriorityBoostPercent,
    );
    effective.set(c.id, weight);
    const floorPaise = expenseTemplates
      .filter((e) => e.categoryId === c.id && e.requirement)
      .reduce((total, e) => total + estimateTotal(toEstimate(e.rate), guests), 0);
    const current = existingByTemplate.get(c.id);
    return {
      id: categoryIdFor(c.id),
      weight: weight.weight,
      floorPaise,
      ...(current?.plannedOrigin === 'user' ? { lockedPaise: current.plannedPaise } : {}),
    };
  });
  const templateIds = new Set(categoryTemplates.map((c) => c.id));
  const externalLocks = existing.filter(
    (c) => c.plannedOrigin === 'user' && !templateIds.has(c.templateId ?? ''),
  );
  for (const c of externalLocks) {
    allocationInputs.push({ id: c.id, weight: 1, lockedPaise: c.plannedPaise });
  }

  const allocation = allocateTargets({
    budgetPaise: profile.budgetPaise,
    reserveBasisPoints,
    categories: allocationInputs,
  });
  const targetById = new Map(allocation.targets.map((t) => [t.id, t]));

  const forecast = forecastExpenses(
    expenses,
    guests,
    categoryTemplates.map((c) => categoryIdFor(c.id)),
  );

  const budgetCategories: BudgetCategory[] = categoryTemplates.map((c) => {
    const id = categoryIdFor(c.id);
    const target = targetById.get(id);
    const weight = effective.get(c.id);
    const locked = target?.source === 'locked';
    const cost = forecast.categories.find((f) => f.categoryId === id)?.forecastPaise ?? 0;
    const boost =
      weight && weight.boostPercent > 0
        ? `, raised ${weight.boostPercent}% for your ${weight.matchedPriorities.join(' and ').replaceAll('-', ' ')} ${weight.matchedPriorities.length > 1 ? 'priorities' : 'priority'}`
        : '';
    const floor =
      target && target.floorPaise > 0
        ? ` Includes ${formatMoney(target.floorPaise)} reserved for required items.`
        : '';
    const rationale = locked
      ? `Fixed by you at ${formatMoney(target.targetPaise)}. Forecast cost is ${formatMoney(cost)}.`
      : `${((target?.shareBasisPoints ?? 0) / 100).toFixed(1)}% of the pool shared by weight (base weight ${c.weight}${boost}).${floor} Forecast cost is ${formatMoney(cost)}. ${c.rationale}`;
    return {
      id,
      templateId: c.id,
      name: existingByTemplate.get(c.id)?.name ?? c.name,
      plannedPaise: target?.targetPaise ?? 0,
      plannedOrigin: locked ? 'user' : 'generated',
      rationale: clip(rationale, 300),
    };
  });

  // --- Tasks ---------------------------------------------------------------
  const taskTemplates = config.tasks.filter((t) => matches(t.when, ctx));
  const applicableTaskIds = new Set(taskTemplates.map((t) => t.id));
  const templateById = new Map(config.tasks.map((t) => [t.id, t]));
  const resolveDependencies = (template: TaskTemplate): string[] => {
    const out = new Set<string>();
    const visit = (ids: readonly string[], seen: Set<string>) => {
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (applicableTaskIds.has(id)) out.add(id);
        else visit(templateById.get(id)?.dependsOn ?? [], seen);
      }
    };
    visit(template.dependsOn, new Set());
    return [...out];
  };

  const cultural = uniqueEntries(preferences.culturalPreferences);
  const doneTemplates = new Set(
    (event.tasks ?? []).flatMap((t) =>
      t.status === 'done' && t.templateId ? [t.templateId] : [],
    ),
  );
  const schedulable: SchedulableTask[] = [
    ...taskTemplates.map((t) => ({
      id: t.id,
      timing: t.timing,
      importance: t.importance,
      dependsOn: resolveDependencies(t),
      done: doneTemplates.has(t.id),
    })),
    ...cultural.map((c) => ({
      id: `task.cultural.${c.key}`,
      timing: { kind: 'before' as const, days: config.culturalPractice.leadDays },
      importance: 'important' as const,
      dependsOn: [],
    })),
  ];
  const scheduled = scheduleTasks({
    eventDate: profile.date,
    today,
    horizonDays: config.planningHorizonDays,
    tasks: schedulable,
  });
  const scheduleById = new Map(scheduled.map((s) => [s.id, s]));
  const titleAndWhy = new Map<
    string,
    { title: string; rationale: string; category: TaskCategory }
  >([
    ...taskTemplates.map(
      (t) =>
        [t.id, { title: t.title, rationale: t.rationale, category: t.category }] as const,
    ),
    ...cultural.map(
      (c) =>
        [
          `task.cultural.${c.key}`,
          {
            title: clip(`Plan how to include: ${c.text}`, 120),
            rationale: config.culturalPractice.taskRationale,
            category: 'celebration' as const,
          },
        ] as const,
    ),
  ]);

  const tasks: PlanningTask[] = schedulable.flatMap((s) => {
    const schedule = scheduleById.get(s.id);
    const text = titleAndWhy.get(s.id);
    if (!schedule || !text) return [];
    return [
      {
        id: generatedId(eventId, s.id),
        templateId: s.id,
        title: text.title,
        dueDate: schedule.dueDate,
        dueDateOrigin: 'generated' as const,
        status: 'todo' as const,
        kind: schedule.kind,
        category: text.category,
        importance: s.importance,
        idealDueDate: schedule.idealDate,
        ...(s.dependsOn.length > 0
          ? { dependsOn: s.dependsOn.map((d) => generatedId(eventId, d)) }
          : {}),
        rationale: clip(`${text.rationale} ${schedule.explanation}`, 600),
      },
    ];
  });
  const schedule = summarizeSchedule(scheduled, daysUntilEvent);

  // --- Ideas and vendor checklists -----------------------------------------
  const ideas: Idea[] = [
    ...config.ideas
      .filter((i) => matches(i.when, ctx))
      .map((i): Idea => ({
        id: generatedId(eventId, i.id),
        templateId: i.id,
        title: i.title,
        details: clip(fillTokens(i.details, ctx), 500),
        kind: i.kind,
        tags: [...i.tags],
        status: 'suggested',
        source: 'built-in',
      })),
    ...cultural.map((c): Idea => ({
      id: generatedId(eventId, `idea.cultural.${c.key}`),
      templateId: `idea.cultural.${c.key}`,
      title: clip(`Include: ${c.text}`, 100),
      details: clip(config.culturalPractice.ideaDetails, 500),
      kind: 'theme',
      tags: ['cultural'],
      status: 'suggested',
      source: 'built-in',
    })),
  ];

  const vendorChecklists: VendorChecklist[] = config.vendorChecklists
    .filter((v) => matches(v.when, ctx))
    .map((v) => ({
      id: v.id,
      vendorKind: v.vendorKind,
      title: v.title,
      items: v.items
        .filter((i) => matches(i.when, ctx))
        .map((i) => fillTokens(i.text, ctx)),
    }));

  // --- Feasibility, conflicts, recommendations -----------------------------
  const feasibility = assessFeasibility({
    budgetPaise: profile.budgetPaise,
    reserveBasisPoints,
    expenses,
    forecast,
    categories: budgetCategories.map((c) => ({
      id: c.id,
      name: c.name,
      targetPaise: c.plannedPaise,
    })),
  });
  const conflicts: Conflict[] = [...feasibility.conflicts];
  for (const problem of allocation.problems) {
    if (problem.kind === 'locked-exceeds-spendable') {
      conflicts.push({
        id: 'conflict.locked-targets-exceed-spendable',
        kind: 'locked-targets-exceed-spendable',
        severity: 'critical',
        amountPaise: problem.amountPaise,
        message: problem.message,
      });
    } else if (problem.kind === 'floors-exceed-spendable') {
      conflicts.push({
        id: 'conflict.required-floors-exceed-spendable',
        kind: 'required-floors-exceed-spendable',
        severity: 'critical',
        amountPaise: problem.amountPaise,
        message: problem.message,
      });
    }
  }

  const boosted = categoryTemplates.flatMap((c) => {
    const w = effective.get(c.id);
    return w && w.boostPercent > 0
      ? [{ name: c.name, boostPercent: w.boostPercent, priorities: w.matchedPriorities }]
      : [];
  });

  const recommendations = buildRecommendations({
    ctx,
    config,
    daysUntilEvent,
    reserveBasisPoints,
    forecast,
    feasibility,
    schedule,
    expenses,
    tasks,
    boosted,
  });

  return {
    status,
    eventId,
    eventType: profile.eventType,
    today,
    daysUntilEvent,
    reserve,
    allocation,
    budgetCategories,
    expenses,
    tasks,
    ideas,
    vendorChecklists,
    forecast,
    conflicts,
    options: feasibility.options,
    schedule,
    recommendations,
    notes,
  };
}
