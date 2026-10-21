import { tryApplyOperations } from '../editEvent.ts';
import { allocate, formatMoney, mulDivFloor } from '../money.ts';
import { LIMITS, MAX_RESERVE_BASIS_POINTS } from '../primitives.ts';
import type { BudgetCategory, ChangeOperation, EventRecord, Priority } from '../types.ts';
import {
  buildLedger,
  categoryWeights,
  requiredFloors,
  reserveBasisPointsOf,
  withRebalance,
  type BudgetLedger,
  type TargetChange,
} from './budget.ts';
import type { Conflict, FeasibilityOption, PlanningConfiguration } from './types.ts';

/**
 * What-if scenarios for the budget. A preview is computed from a copy of the
 * record and never changes it; applying it later goes through the ordinary
 * validated edit path with the revision it was computed against, so a
 * preview made before another edit is rejected as stale.
 *
 * Scenarios only touch the profile (budget, guests, reserve) and category
 * targets. Expenses, agreed costs, payments, tasks, guests, vendors and ideas
 * are never part of a scenario's operations, so they survive unchanged.
 */

export type BudgetScenario =
  | { kind: 'reduce-budget'; percent: number }
  | { kind: 'increase-guests'; percent: number }
  | { kind: 'set-reserve'; basisPoints: number }
  | { kind: 'prioritise'; priority: Priority; percent: number };

export const SCENARIO_DEFAULTS = {
  budgetCutPercent: 15,
  guestIncreasePercent: 20,
  priorityBoostPercent: 20,
} as const;

export type ScenarioStatus =
  /** Can be applied. */
  | 'ok'
  /** Would change nothing; the reason says why. */
  | 'no-change'
  /** Cannot be computed or would leave the event invalid. */
  | 'invalid';

export interface ScenarioMetric {
  key: 'budget' | 'guests' | 'reserve' | 'forecast' | 'headroom' | 'shortfall';
  label: string;
  before: number;
  after: number;
  /** `false` for counts such as guests. */
  money: boolean;
}

export interface RecommendationChange {
  id: string;
  before: string | null;
  after: string | null;
}

export interface ScenarioPreview {
  scenario: BudgetScenario;
  title: string;
  eventId: string;
  /** The event revision this preview was computed against. */
  baseRevision: number;
  status: ScenarioStatus;
  reasons: string[];
  operations: ChangeOperation[];
  before: BudgetLedger;
  after: BudgetLedger | null;
  metrics: ScenarioMetric[];
  /** Recommended category targets that move. */
  targetChanges: TargetChange[];
  /** Ways to close a gap that appear, disappear or change. */
  recommendations: RecommendationChange[];
  conflicts: { introduced: Conflict[]; resolved: Conflict[]; remaining: Conflict[] };
  /** What the scenario costs or gives up, in plain words. */
  tradeOffs: string[];
}

const pct = (basisPoints: number): string => `${(basisPoints / 100).toString()}%`;
const sum = (values: readonly number[]): number =>
  values.reduce((total, v) => total + v, 0);
const signed = (paise: number): string =>
  `${paise > 0 ? '+' : paise < 0 ? '−' : ''}${formatMoney(Math.abs(paise))}`;
const words = (value: string): string => value.replaceAll('-', ' ');

export function scenarioTitle(scenario: BudgetScenario): string {
  switch (scenario.kind) {
    case 'reduce-budget':
      return `Reduce the budget by ${scenario.percent}%`;
    case 'increase-guests':
      return `Increase guests by ${scenario.percent}%`;
    case 'set-reserve':
      return `Change the reserve to ${pct(scenario.basisPoints)}`;
    case 'prioritise':
      return `Give ${words(scenario.priority)} ${scenario.percent}% more`;
  }
}

/** True while the event is still at the revision the preview was made from. */
export function isPreviewCurrent(preview: ScenarioPreview, record: EventRecord): boolean {
  return (
    preview.eventId === record.profile.id &&
    preview.baseRevision === record.profile.revision
  );
}

type Built =
  | { ok: true; operations: ChangeOperation[] }
  | { ok: false; reason: string; status: ScenarioStatus };

function buildOperations(
  record: EventRecord,
  scenario: BudgetScenario,
  configuration: PlanningConfiguration,
): Built {
  const { profile } = record;
  const rebalanced = (
    patch: Extract<ChangeOperation, { op: 'profile/patch' }>['patch'],
  ): Built => {
    const edit = withRebalance(record, configuration, [{ op: 'profile/patch', patch }]);
    return edit.ok
      ? { ok: true, operations: edit.operations }
      : { ok: false, status: 'invalid', reason: edit.issues.join(' ') };
  };

  switch (scenario.kind) {
    case 'reduce-budget': {
      if (
        !Number.isInteger(scenario.percent) ||
        scenario.percent <= 0 ||
        scenario.percent >= 100
      ) {
        return {
          ok: false,
          status: 'invalid',
          reason: 'The cut must be between 1% and 99%.',
        };
      }
      const budgetPaise = Math.max(
        1,
        mulDivFloor(profile.budgetPaise, 100 - scenario.percent, 100),
      );
      if (budgetPaise === profile.budgetPaise) {
        return {
          ok: false,
          status: 'no-change',
          reason: 'The budget is too small to reduce.',
        };
      }
      return rebalanced({ budgetPaise });
    }
    case 'increase-guests': {
      if (!Number.isInteger(scenario.percent) || scenario.percent <= 0) {
        return {
          ok: false,
          status: 'invalid',
          reason: 'The increase must be a positive whole percentage.',
        };
      }
      const extra = Math.ceil((profile.guestCount * scenario.percent) / 100);
      const guestCount = Math.min(LIMITS.guestCount, profile.guestCount + extra);
      if (guestCount === profile.guestCount) {
        return {
          ok: false,
          status: 'no-change',
          reason: `The guest count is already at the limit of ${LIMITS.guestCount}.`,
        };
      }
      return rebalanced({ guestCount });
    }
    case 'set-reserve': {
      const bp = scenario.basisPoints;
      if (!Number.isInteger(bp) || bp < 0 || bp > MAX_RESERVE_BASIS_POINTS) {
        return {
          ok: false,
          status: 'invalid',
          reason: `The reserve must be between 0% and ${pct(MAX_RESERVE_BASIS_POINTS)}.`,
        };
      }
      if (bp === reserveBasisPointsOf(profile)) {
        return {
          ok: false,
          status: 'no-change',
          reason: `The reserve is already ${pct(bp)}.`,
        };
      }
      return rebalanced({ reserveBasisPoints: bp });
    }
    case 'prioritise':
      return priorityShift(record, configuration, scenario.priority, scenario.percent);
  }
}

/**
 * Raises the unlocked targets of categories that serve a priority by a
 * percentage, taking exactly that amount from the other unlocked targets in
 * proportion to what they hold above their required provisions. Totals stay
 * the same to the paisa. The raised targets become locked, because applying
 * the scenario is an explicit choice that a later rebalance should keep.
 */
function priorityShift(
  record: EventRecord,
  configuration: PlanningConfiguration,
  priority: Priority,
  percent: number,
): Built {
  if (!Number.isInteger(percent) || percent <= 0 || percent > 100) {
    return {
      ok: false,
      status: 'invalid',
      reason: 'The increase must be between 1% and 100%.',
    };
  }
  const templates = configuration.types[record.profile.eventType].categories;
  const serves = (c: BudgetCategory): boolean =>
    templates.find((t) => t.id === c.templateId)?.priorities.includes(priority) ?? false;
  const weights = categoryWeights(record, configuration, record.preferences.priorities);
  const open = record.budgetCategories.filter(
    (c) => c.plannedOrigin !== 'user' && weights.has(c.id),
  );
  const gainers = open.filter(serves);
  const donors = open.filter((c) => !serves(c));
  const label = words(priority);

  if (gainers.length === 0) {
    const lockedServing = record.budgetCategories.filter(
      (c) => c.plannedOrigin === 'user' && serves(c),
    );
    return {
      ok: false,
      status: 'no-change',
      reason:
        lockedServing.length > 0
          ? `${lockedServing.map((c) => c.name).join(', ')} ${lockedServing.length === 1 ? 'serves' : 'serve'} ${label} but ${lockedServing.length === 1 ? 'is' : 'are'} locked. Unlock ${lockedServing.length === 1 ? 'it' : 'them'} first, or edit the target directly.`
          : `No category in this budget serves ${label}.`,
    };
  }
  if (donors.length === 0) {
    return {
      ok: false,
      status: 'no-change',
      reason: `Every other category is locked, so there is nowhere to take money from. Unlock a target first.`,
    };
  }

  const floors = requiredFloors(record.expenses, record.profile.guestCount);
  const gainBase = sum(gainers.map((c) => c.plannedPaise));
  const slack = donors.map((c) => Math.max(0, c.plannedPaise - (floors.get(c.id) ?? 0)));
  const wanted = mulDivFloor(
    gainBase > 0 ? gainBase : sum(open.map((c) => c.plannedPaise)),
    percent,
    100,
  );
  const shift = Math.min(wanted, sum(slack));
  if (shift === 0) {
    return {
      ok: false,
      status: 'no-change',
      reason:
        'The other unlocked targets hold nothing above their required provisions, so nothing can move.',
    };
  }

  const gains = allocate(
    shift,
    gainBase > 0 ? gainers.map((c) => c.plannedPaise) : gainers.map(() => 1),
  );
  const takes = allocate(shift, slack);
  const operations: ChangeOperation[] = [
    ...gainers.map((c, i): ChangeOperation => {
      const plannedPaise = c.plannedPaise + (gains[i] ?? 0);
      return {
        op: 'budgetCategories/upsert',
        item: {
          ...c,
          plannedPaise,
          plannedOrigin: 'user',
          rationale: `Raised for your ${label} priority in a what-if you applied, to ${formatMoney(plannedPaise)}. Locked so rebalancing keeps it; unlock to share it by weight again.`,
        },
      };
    }),
    ...donors.flatMap((c, i): ChangeOperation[] => {
      const take = takes[i] ?? 0;
      return take === 0
        ? []
        : [
            {
              op: 'budgetCategories/upsert',
              item: {
                ...c,
                plannedPaise: c.plannedPaise - take,
                rationale: `Lowered by ${formatMoney(take)} to give ${label} more in a what-if you applied.`,
              },
            },
          ];
    }),
  ];
  return { ok: true, operations };
}

function diffConflicts(
  before: readonly Conflict[],
  after: readonly Conflict[],
): ScenarioPreview['conflicts'] {
  const beforeIds = new Set(before.map((c) => c.id));
  const afterIds = new Set(after.map((c) => c.id));
  return {
    introduced: after.filter((c) => !beforeIds.has(c.id)),
    resolved: before.filter((c) => !afterIds.has(c.id)),
    remaining: after.filter((c) => beforeIds.has(c.id)),
  };
}

function diffOptions(
  before: readonly FeasibilityOption[],
  after: readonly FeasibilityOption[],
): RecommendationChange[] {
  const ids = [...new Set([...before.map((o) => o.id), ...after.map((o) => o.id)])];
  return ids.flatMap((id) => {
    const b = before.find((o) => o.id === id)?.description ?? null;
    const a = after.find((o) => o.id === id)?.description ?? null;
    return a === b ? [] : [{ id, before: b, after: a }];
  });
}

function targetChanges(before: BudgetLedger, after: BudgetLedger): TargetChange[] {
  return after.categories.flatMap((a) => {
    const b = before.categories.find((c) => c.id === a.id);
    if (!b || (b.targetPaise === a.targetPaise && b.locked === a.locked)) return [];
    return [
      {
        id: a.id,
        name: a.name,
        beforePaise: b.targetPaise,
        afterPaise: a.targetPaise,
        locked: a.locked,
      },
    ];
  });
}

function tradeOffsFor(
  scenario: BudgetScenario,
  before: BudgetLedger,
  after: BudgetLedger,
  changes: readonly TargetChange[],
): string[] {
  const out: string[] = [];
  const forecastDelta = after.forecastPaise - before.forecastPaise;

  switch (scenario.kind) {
    case 'reduce-budget':
      out.push(
        `Cutting the budget does not cut costs: the forecast ${forecastDelta === 0 ? `stays at ${formatMoney(after.forecastPaise)}` : `moves to ${formatMoney(after.forecastPaise)}`}.`,
      );
      if (after.reservePaise !== before.reservePaise) {
        out.push(
          `The reserve is ${pct(after.reserveBasisPoints)} of the budget, so it falls from ${formatMoney(before.reservePaise)} to ${formatMoney(after.reservePaise)}.`,
        );
      }
      break;
    case 'increase-guests': {
      const extra = after.guestCount - before.guestCount;
      let estimates = 0;
      let agreed = 0;
      for (const item of after.items) {
        const old = before.items.find((i) => i.expenseId === item.expenseId);
        if (!old) continue;
        const delta = item.forecastPaise - old.forecastPaise;
        if (item.basis === 'commitment') agreed += delta;
        else estimates += delta;
      }
      out.push(
        `${extra} more ${extra === 1 ? 'guest adds' : 'guests add'} ${formatMoney(forecastDelta)} to the forecast (${formatMoney(after.perGuestPaise)} per guest across per-guest items): ${formatMoney(estimates)} on per-guest estimates${agreed > 0 ? ` and ${formatMoney(agreed)} on agreed per-guest rates` : ''}.`,
      );
      out.push(
        `Fixed costs and agreed fixed totals (${formatMoney(after.fixedPaise)}) do not change, and recorded payments stay as they are.`,
      );
      break;
    }
    case 'set-reserve': {
      const delta = after.reservePaise - before.reservePaise;
      out.push(
        delta > 0
          ? `Holding back ${formatMoney(delta)} more for surprises leaves ${formatMoney(delta)} less for spending targets and headroom.`
          : `Holding back ${formatMoney(-delta)} less for surprises frees it for targets, but leaves a smaller cushion if costs rise.`,
      );
      break;
    }
    case 'prioritise': {
      const gains = changes.filter((c) => c.afterPaise > c.beforePaise);
      const losses = changes.filter((c) => c.afterPaise < c.beforePaise);
      out.push(
        `${gains.map((c) => `${c.name} ${signed(c.afterPaise - c.beforePaise)}`).join(', ')}, taken from ${losses.map((c) => `${c.name} ${signed(c.afterPaise - c.beforePaise)}`).join(', ')}. The total of targets is unchanged.`,
      );
      out.push(
        `The raised ${gains.length === 1 ? 'target becomes' : 'targets become'} locked so a later rebalance keeps ${gains.length === 1 ? 'it' : 'them'}. Unlock to share by weight again.`,
      );
      out.push(
        'Moving targets does not change what anything costs: the forecast and headroom stay the same.',
      );
      break;
    }
  }

  if (scenario.kind !== 'prioritise') {
    const moved = changes.filter((c) => !c.locked);
    if (moved.length > 0) {
      const delta = sum(moved.map((c) => c.afterPaise - c.beforePaise));
      out.push(
        `${moved.length} unlocked ${moved.length === 1 ? 'target moves' : 'targets move'} by ${signed(delta)} in total. Locked targets (${formatMoney(after.lockedTargetsPaise)}) are kept exactly.`,
      );
    } else if (after.allLocked && after.categories.length > 0) {
      out.push(
        `Every target is locked, so none moves. ${after.allocationDifferencePaise >= 0 ? `${formatMoney(after.allocationDifferencePaise)} would be unallocated` : `Targets would be ${formatMoney(-after.allocationDifferencePaise)} more than the money left after the reserve`}; edit or unlock a target.`,
      );
    }
  }

  if (after.headroomPaise !== before.headroomPaise) {
    out.push(
      `Headroom ${after.headroomPaise > before.headroomPaise ? 'rises' : 'falls'} from ${formatMoney(before.headroomPaise)} to ${formatMoney(after.headroomPaise)}.`,
    );
  }
  if (after.lockedTargetsPaise > after.spendablePaise) {
    out.push(
      `Locked targets would exceed the money left after the reserve by ${formatMoney(after.lockedTargetsPaise - after.spendablePaise)}. No target is unlocked for you, and no target goes below zero.`,
    );
  }
  if (after.shortfallPaise > 0) {
    out.push(
      `The forecast would be ${formatMoney(after.shortfallPaise)} over the whole budget. This shortfall stays visible after applying until costs, guests or the budget change.`,
    );
  } else if (after.gapPaise > 0) {
    out.push(`The forecast would use ${formatMoney(after.gapPaise)} of the reserve.`);
  }
  return out;
}

/**
 * Computes a scenario against a copy of the record. Nothing is changed; the
 * returned operations are applied only if the user chooses Apply.
 */
export function previewScenario(
  record: EventRecord,
  scenario: BudgetScenario,
  configuration: PlanningConfiguration,
): ScenarioPreview {
  const before = buildLedger(record, configuration);
  const base = {
    scenario,
    title: scenarioTitle(scenario),
    eventId: record.profile.id,
    baseRevision: record.profile.revision,
    before,
  };
  const empty = (status: ScenarioStatus, reasons: string[]): ScenarioPreview => ({
    ...base,
    status,
    reasons,
    operations: [],
    after: null,
    metrics: [],
    targetChanges: [],
    recommendations: [],
    conflicts: { introduced: [], resolved: [], remaining: before.conflicts },
    tradeOffs: [],
  });

  const built = buildOperations(record, scenario, configuration);
  if (!built.ok) return empty(built.status, [built.reason]);
  const applied = tryApplyOperations(record, built.operations);
  if (!applied.ok) {
    return empty('invalid', [
      'The scenario would leave the event invalid.',
      ...applied.issues,
    ]);
  }

  const after = buildLedger(applied.record, configuration);
  const changes = targetChanges(before, after);
  const metric = (
    key: ScenarioMetric['key'],
    label: string,
    pick: (l: BudgetLedger) => number,
    money = true,
  ): ScenarioMetric => ({ key, label, before: pick(before), after: pick(after), money });

  return {
    ...base,
    status: 'ok',
    reasons: [],
    operations: built.operations,
    after,
    metrics: [
      metric('budget', 'Budget', (l) => l.budgetPaise),
      metric('guests', 'Guests', (l) => l.guestCount, false),
      metric('reserve', 'Reserve', (l) => l.reservePaise),
      metric('forecast', 'Forecast', (l) => l.forecastPaise),
      metric('headroom', 'Headroom', (l) => l.headroomPaise),
      metric('shortfall', 'Over the whole budget', (l) => l.shortfallPaise),
    ],
    targetChanges: changes,
    recommendations: diffOptions(before.options, after.options),
    conflicts: diffConflicts(before.conflicts, after.conflicts),
    tradeOffs: tradeOffsFor(scenario, before, after, changes),
  };
}
