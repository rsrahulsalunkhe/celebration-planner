import { formatDate } from '../dates.ts';
import { formatMoney } from '../money.ts';
import type { ExpenseItem, PlanningTask } from '../types.ts';
import type { Feasibility } from './feasibility.ts';
import type {
  EventTypeConfiguration,
  Forecast,
  PlanningContext,
  Recommendation,
  ScheduleSummary,
} from './types.ts';

export interface BoostedCategory {
  name: string;
  boostPercent: number;
  priorities: readonly string[];
}

export interface RecommendationInput {
  ctx: PlanningContext;
  config: EventTypeConfiguration;
  daysUntilEvent: number;
  reserveBasisPoints: number;
  forecast: Forecast;
  feasibility: Feasibility;
  schedule: ScheduleSummary;
  expenses: readonly ExpenseItem[];
  tasks: readonly PlanningTask[];
  boosted: readonly BoostedCategory[];
}

const pct = (basisPoints: number): string => `${(basisPoints / 100).toString()}%`;
const words = (items: readonly string[]): string => items.join(', ').replaceAll('-', ' ');
const taskIdFor = (tasks: readonly PlanningTask[], templateId: string): string[] =>
  tasks.filter((t) => t.templateId === templateId).map((t) => t.id);

/**
 * Recommendations are built only from facts about this event. Each carries a
 * `because` list naming those facts, so the reader can see why it appears and
 * check that it applies. Nothing is added for facts the user did not give.
 */
export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const { ctx, config, daysUntilEvent, reserveBasisPoints, forecast, feasibility } =
    input;
  const { schedule, expenses, tasks, boosted } = input;
  const { profile, preferences } = ctx;
  const out: Recommendation[] = [];
  const eventLabel = config.label.toLowerCase();
  const when = formatDate(profile.date);

  // 1. Budget status, always.
  const budgetFacts = [
    `Budget ${formatMoney(profile.budgetPaise)}`,
    `Reserve ${pct(reserveBasisPoints)} (${formatMoney(feasibility.reservePaise)})`,
    `${profile.guestCount} guests`,
  ];
  if (feasibility.shortfallPaise > 0) {
    out.push({
      id: 'recommendation.budget',
      kind: 'budget',
      title: 'The forecast is over budget',
      detail: `Forecast ${formatMoney(forecast.forecastPaise)} exceeds the whole ${formatMoney(profile.budgetPaise)} budget by ${formatMoney(feasibility.shortfallPaise)}. ${feasibility.options.length} ways to close the gap are listed with exact numbers.`,
      because: budgetFacts,
    });
  } else if (feasibility.gapPaise > 0) {
    out.push({
      id: 'recommendation.budget',
      kind: 'budget',
      title: 'The forecast uses part of the reserve',
      detail: `Forecast ${formatMoney(forecast.forecastPaise)} is ${formatMoney(feasibility.gapPaise)} above the ${formatMoney(feasibility.spendablePaise)} meant for spending, so it dips into the reserve.`,
      because: budgetFacts,
    });
  } else {
    out.push({
      id: 'recommendation.budget',
      kind: 'budget',
      title: 'The forecast fits within the spendable budget',
      detail: `Forecast ${formatMoney(forecast.forecastPaise)} against ${formatMoney(feasibility.spendablePaise)} spendable leaves ${formatMoney(feasibility.spendablePaise - forecast.forecastPaise)} of headroom, with the reserve untouched.`,
      because: budgetFacts,
    });
  }

  // 2. Compressed schedule.
  if (schedule.compressed) {
    const immediate = tasks.filter(
      (t) =>
        t.idealDueDate !== undefined &&
        t.idealDueDate < t.dueDate &&
        t.importance === 'critical',
    );
    out.push({
      id: 'recommendation.catch-up',
      kind: 'schedule',
      title: 'Start the catch-up work today',
      detail: `${schedule.explanation} The most important steps are scheduled first, at most two critical steps a day.`,
      because: [
        `${daysUntilEvent} ${daysUntilEvent === 1 ? 'day' : 'days'} until ${when}`,
        `The usual planning horizon for a ${eventLabel} is ${config.planningHorizonDays} days`,
        `${schedule.behindCount} steps are past their usual deadline`,
      ],
      taskIds: immediate.map((t) => t.id),
    });
  }

  // 3. Outdoor backup, without any weather forecast.
  if (profile.setting !== 'indoor') {
    const cover = expenses.find((e) => e.templateId === 'expense.weather-cover');
    const coverText = cover
      ? ` ${formatMoney(forecast.items.find((i) => i.expenseId === cover.id)?.forecastPaise ?? 0)} is budgeted for covered space.`
      : '';
    out.push({
      id: 'recommendation.outdoor-backup',
      kind: 'outdoor',
      title: 'Agree a backup for the outdoor part',
      detail: `Your ${eventLabel} is ${profile.setting === 'outdoor' ? 'outdoors' : 'partly outdoors'} in ${profile.city} on ${when}. The plan adds a step to choose a backup and the time by which to decide it.${coverText} It does not predict the weather.`,
      because: [`Setting: ${profile.setting}`, `City: ${profile.city}`, `Date: ${when}`],
      taskIds: taskIdFor(tasks, 'task.weather-backup'),
    });
  }

  // 4. Accessibility.
  if (preferences.accessibilityNeeds.length > 0) {
    const required = expenses.filter(
      (e) => e.requirement !== undefined && e.requirement !== 'dietary',
    );
    const total = required.reduce(
      (sum, e) =>
        sum + (forecast.items.find((i) => i.expenseId === e.id)?.forecastPaise ?? 0),
      0,
    );
    out.push({
      id: 'recommendation.accessibility',
      kind: 'accessibility',
      title: 'Required accessibility provisions are budgeted and protected',
      detail: `You listed ${words(preferences.accessibilityNeeds)}. ${formatMoney(total)} is budgeted for these across ${required.length} ${required.length === 1 ? 'item' : 'items'}, ahead of other categories. They are never offered as savings.`,
      because: [
        `Accessibility needs: ${words(preferences.accessibilityNeeds)}`,
        `${profile.guestCount} guests`,
      ],
      taskIds: taskIdFor(tasks, 'task.check-access'),
    });
  }

  // 5. Dietary needs.
  if (preferences.dietaryNeeds.length > 0) {
    const item = expenses.find((e) => e.templateId === 'expense.dietary-provision');
    const cost = item
      ? (forecast.items.find((i) => i.expenseId === item.id)?.forecastPaise ?? 0)
      : 0;
    out.push({
      id: 'recommendation.dietary',
      kind: 'dietary',
      title: 'Confirm the menu for the stated dietary needs',
      detail: `You listed ${words(preferences.dietaryNeeds)}. ${formatMoney(cost)} is budgeted across all ${profile.guestCount} guests because the number with each need is unknown. Confirm the menu with the caterer before it is fixed. This is never offered as a saving.`,
      because: [
        `Dietary needs: ${words(preferences.dietaryNeeds)}`,
        `${profile.guestCount} guests`,
      ],
      taskIds: taskIdFor(tasks, 'task.dietary-menu'),
    });
  }

  // 6. Cultural practices, only when the user listed them.
  if (preferences.culturalPreferences.length > 0) {
    out.push({
      id: 'recommendation.cultural',
      kind: 'cultural',
      title: 'Cultural preferences you listed are in the plan',
      detail: `A planning step and an idea were added for each entry you listed. Nothing was added that you did not ask for, and no details were assumed.`,
      because: preferences.culturalPreferences.map((p) => `You listed: ${p}`),
      taskIds: tasks
        .filter((t) => t.templateId?.startsWith('task.cultural.'))
        .map((t) => t.id),
    });
  }

  // 7. Guest-count sensitivity.
  const perGuestShare =
    forecast.forecastPaise === 0
      ? 0
      : (forecast.perGuestPaise * forecast.guestCount) / forecast.forecastPaise;
  if (forecast.perGuestPaise > 0 && perGuestShare >= 0.4) {
    out.push({
      id: 'recommendation.guest-count',
      kind: 'guests',
      title: 'Guest count is a major cost driver',
      detail: `Per-guest items are ${Math.round(perGuestShare * 100)}% of the forecast, ${formatMoney(forecast.perGuestPaise)} per guest. Ten fewer guests would save ${formatMoney(forecast.perGuestPaise * Math.min(10, forecast.guestCount - 1))}; fixed costs of ${formatMoney(forecast.fixedPaise)} would not change.`,
      because: [
        `${profile.guestCount} guests`,
        `${formatMoney(forecast.perGuestPaise)} per guest across per-guest items`,
      ],
    });
  }

  // 8. Reserve.
  if (reserveBasisPoints < 500) {
    out.push({
      id: 'recommendation.reserve',
      kind: 'reserve',
      title:
        reserveBasisPoints === 0
          ? 'There is no contingency reserve'
          : 'The contingency reserve is small',
      detail: `The reserve is ${pct(reserveBasisPoints)} of the budget (${formatMoney(feasibility.reservePaise)}). Unexpected costs are common, so consider keeping at least 5%.`,
      because: [
        `Reserve ${pct(reserveBasisPoints)}`,
        `Budget ${formatMoney(profile.budgetPaise)}`,
      ],
    });
  }

  // 9. Priorities.
  if (boosted.length > 0) {
    out.push({
      id: 'recommendation.priorities',
      kind: 'priorities',
      title: 'Your priorities shaped the targets',
      detail: `${boosted.map((b) => `${b.name} was raised ${b.boostPercent}% for ${words(b.priorities)}`).join('; ')}. The other categories share the rest by their usual weights.`,
      because: [`Priorities: ${words(preferences.priorities)}`],
    });
  }

  // 10. Age band, only when given.
  if (profile.eventType === 'birthday' && profile.ageBand) {
    const note =
      profile.ageBand === 'under-13'
        ? 'supervised activities and a calm space are suggested'
        : profile.ageBand === '65-plus' || profile.ageBand === '50-64'
          ? 'seating and easy access to food are suggested'
          : 'no age-specific changes are made';
    out.push({
      id: 'recommendation.age-band',
      kind: 'age',
      title: 'Activities are matched to the age band you gave',
      detail: `For the age band ${profile.ageBand}, ${note}. Only the band is used; no birth date is asked for.`,
      because: [`Age band: ${profile.ageBand}`, `${profile.guestCount} guests`],
    });
  }

  return out;
}
