import { templateIdSchema } from '../primitives.ts';
import { validateTaskTemplates } from './deadlines.ts';
import type { EventTypeConfiguration, PlanningConfiguration } from './types.ts';

const isPaise = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

function validateType(config: EventTypeConfiguration): string[] {
  const problems: string[] = [];
  const at = (message: string) => problems.push(`${config.eventType}: ${message}`);

  const ids = [
    ...config.categories.map((c) => c.id),
    ...config.expenses.map((e) => e.id),
    ...config.tasks.map((t) => t.id),
    ...config.ideas.map((i) => i.id),
    ...config.vendorChecklists.map((v) => v.id),
  ];
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i)))
    at(`duplicate id ${id}`);
  for (const id of [
    ...config.categories.map((c) => c.id),
    ...config.expenses.map((e) => e.id),
    ...config.tasks.map((t) => t.id),
    ...config.ideas.map((i) => i.id),
  ]) {
    if (!templateIdSchema.safeParse(id).success) at(`malformed template id ${id}`);
  }

  if (!Number.isInteger(config.planningHorizonDays) || config.planningHorizonDays < 1) {
    at('planning horizon must be a positive whole number of days');
  }
  if (
    !Number.isInteger(config.culturalPractice.leadDays) ||
    config.culturalPractice.leadDays < 1
  ) {
    at('cultural practice lead time must be a positive whole number of days');
  }

  const categoryIds = new Set(config.categories.map((c) => c.id));
  for (const c of config.categories) {
    if (!Number.isSafeInteger(c.weight) || c.weight <= 0)
      at(`category ${c.id} needs a positive integer weight`);
    if (!config.expenses.some((e) => e.categoryId === c.id))
      at(`category ${c.id} has no expense templates`);
  }
  for (const e of config.expenses) {
    if (!categoryIds.has(e.categoryId))
      at(`expense ${e.id} uses unknown category ${e.categoryId}`);
    const amount = e.rate.basis === 'fixed' ? e.rate.amountPaise : e.rate.perGuestPaise;
    if (!isPaise(amount)) at(`expense ${e.id} has an invalid rate`);
    if (e.requirement && !e.when) at(`required expense ${e.id} must say when it applies`);
  }

  for (const problem of validateTaskTemplates(config.tasks)) at(problem);

  const tags = new Set(config.ideaTags.map((t) => t.tag));
  const expenseIds = new Set(config.expenses.map((e) => e.id));
  for (const idea of config.ideas) {
    const f = idea.facets;
    if (!Number.isInteger(f.leadDays) || f.leadDays < 0)
      at(`idea ${idea.id} needs a whole number of lead days`);
    if (!Number.isInteger(f.task.leadDays) || f.task.leadDays < 0)
      at(`idea ${idea.id} task needs a whole number of lead days`);
    if (f.task.title.trim().length === 0 || f.task.title.length > 120)
      at(`idea ${idea.id} task title must be 1 to 120 characters`);
    if (f.settings.length === 0) at(`idea ${idea.id} must work in at least one setting`);
    if (f.costFrom !== undefined && !expenseIds.has(f.costFrom))
      at(`idea ${idea.id} uses unknown expense ${f.costFrom} for its cost`);
    if (idea.kind === 'food' && f.suitsDiets === undefined)
      at(`food idea ${idea.id} must say which dietary needs it suits`);
    if (idea.tags.length === 0) at(`idea ${idea.id} has no tags`);
    for (const tag of idea.tags)
      if (!tags.has(tag)) at(`idea ${idea.id} uses unknown tag ${tag}`);
  }
  for (const list of config.vendorChecklists) {
    if (list.items.length === 0) at(`checklist ${list.id} has no items`);
  }
  return problems;
}

/** Returns every problem found in the configuration; an empty list means it is valid. */
export function validateConfiguration(configuration: PlanningConfiguration): string[] {
  const problems: string[] = [];
  if (
    !Number.isInteger(configuration.priorityBoostPercent) ||
    configuration.priorityBoostPercent < 0 ||
    configuration.maxPriorityBoostPercent < configuration.priorityBoostPercent
  ) {
    problems.push('priority boost settings are invalid');
  }
  for (const config of Object.values(configuration.types))
    problems.push(...validateType(config));
  return problems;
}

export class PlanningConfigurationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid planning configuration: ${problems.join('; ')}`);
    this.name = 'PlanningConfigurationError';
    this.problems = problems;
  }
}

/** The configuration is code, not user input, so a defect there is an error, not a result. */
export function assertValidConfiguration(configuration: PlanningConfiguration): void {
  const problems = validateConfiguration(configuration);
  if (problems.length > 0) throw new PlanningConfigurationError(problems);
}
