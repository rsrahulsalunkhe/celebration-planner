import { describe, expect, it } from 'vitest';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { TODAY, presetEvent, withProfile } from '@/test/helpers.ts';
import { addDays, daysBetween } from '../dates.ts';
import { tryApplyOperations } from '../editEvent.ts';
import type { EventRecord, Preferences } from '../types.ts';
import { assertValidConfiguration, validateConfiguration } from './configuration.ts';
import { entryKey, generatePlan } from './generate.ts';
import { reconcileOperations } from './reconcile.ts';
import type { GeneratedPlan, PlanningConfiguration } from './types.ts';

const PRESETS = ['wedding', 'birthday', 'community'] as const;
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

const plan = (record: EventRecord, today = TODAY): GeneratedPlan =>
  generatePlan(record, PLANNING_CONFIGURATION, today);
const preset = (id: (typeof PRESETS)[number]) => presetEvent(id);
const withPreferences = (
  record: EventRecord,
  changes: Partial<Preferences>,
): EventRecord => ({
  ...record,
  preferences: { ...record.preferences, ...changes },
});
const forecastOf = (p: GeneratedPlan, templateId: string): number | undefined => {
  const item = p.expenses.find((e) => e.templateId === templateId);
  return p.forecast.items.find((i) => i.expenseId === item?.id)?.forecastPaise;
};

describe('configuration', () => {
  it('is valid', () => {
    expect(validateConfiguration(PLANNING_CONFIGURATION)).toEqual([]);
    expect(() => {
      assertValidConfiguration(PLANNING_CONFIGURATION);
    }).not.toThrow();
  });

  it('rejects defects, including task dependency cycles', () => {
    const wedding = PLANNING_CONFIGURATION.types.wedding;
    const first = wedding.categories[0];
    const orphan = wedding.expenses[0];
    if (!first || !orphan) throw new Error('fixture');
    const broken: PlanningConfiguration = {
      ...PLANNING_CONFIGURATION,
      types: {
        ...PLANNING_CONFIGURATION.types,
        wedding: {
          ...wedding,
          // Venue already depends on the budget step; this closes a cycle.
          tasks: wedding.tasks.map((task) =>
            task.id === 'task.set-budget'
              ? { ...task, dependsOn: ['task.book-venue'] }
              : task,
          ),
          categories: [{ ...first, weight: 0 }, ...wedding.categories.slice(1)],
          expenses: [
            ...wedding.expenses,
            { ...orphan, id: 'expense.orphan', categoryId: 'category.nope' },
          ],
        },
      },
    };
    const problems = validateConfiguration(broken).join('\n');
    expect(problems).toMatch(/cycle/);
    expect(problems).toMatch(/positive integer weight/);
    expect(problems).toMatch(/unknown category/);
    expect(() => generatePlan(preset('wedding'), broken, TODAY)).toThrow(
      /Invalid planning configuration/,
    );
  });
});

describe('distinct plans for the three presets', () => {
  const plans = Object.fromEntries(PRESETS.map((id) => [id, plan(preset(id))])) as Record<
    (typeof PRESETS)[number],
    GeneratedPlan
  >;

  it('are generated, upcoming, balanced and within the stated budgets', () => {
    for (const id of PRESETS) {
      const p = plans[id];
      const record = preset(id);
      expect(p.status).toBe('upcoming');
      expect(p.allocation.balanced).toBe(true);
      expect(sum(p.allocation.targets.map((t) => t.targetPaise)) + p.reserve.paise).toBe(
        record.profile.budgetPaise,
      );
      expect(p.reserve.basisPoints).toBe(1000);
      expect(p.reserve.isDefault).toBe(true);
      expect(
        p.conflicts.some((c) => c.severity === 'critical' || c.severity === 'blocking'),
      ).toBe(false);
      expect(p.forecast.forecastPaise).toBeLessThanOrEqual(p.allocation.spendablePaise);
    }
  });

  it('have different category weights, milestone tasks, vendor checklists and idea tags', () => {
    const weights = PRESETS.map((id) =>
      PLANNING_CONFIGURATION.types[id].categories
        .map((c) => `${c.id}:${c.weight}`)
        .join(),
    );
    expect(new Set(weights).size).toBe(3);

    const taskSets = PRESETS.map((id) =>
      plans[id].tasks
        .map((t) => t.templateId)
        .sort()
        .join(),
    );
    expect(new Set(taskSets).size).toBe(3);

    const checklistTitles = PRESETS.map((id) =>
      plans[id].vendorChecklists.map((c) => c.title).join(),
    );
    expect(new Set(checklistTitles).size).toBe(3);

    const tagSets = PRESETS.map(
      (id) => new Set(PLANNING_CONFIGURATION.types[id].ideaTags.map((t) => t.tag)),
    );
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      expect([...(tagSets[a] ?? [])].filter((tag) => tagSets[b]?.has(tag))).toEqual([]);
    }
    // Every generated idea only uses its own type's tags (cultural aside).
    for (const id of PRESETS) {
      const allowed = new Set(
        PLANNING_CONFIGURATION.types[id].ideaTags.map((t) => t.tag),
      );
      for (const idea of plans[id].ideas)
        for (const tag of idea.tags ?? []) expect(allowed.has(tag)).toBe(true);
    }
  });

  it('give each type its own milestones and planning horizon', () => {
    const ids = (id: (typeof PRESETS)[number]) =>
      new Set(plans[id].tasks.map((t) => t.templateId));
    // The wedding demo did not choose the ceremony as a priority, so no ceremony is assumed.
    expect(ids('wedding').has('task.ceremony-plan')).toBe(false);
    expect(ids('wedding').has('task.order-of-day')).toBe(true);
    expect(ids('wedding').has('task.menu-tasting')).toBe(true);
    expect(ids('birthday').has('task.cake-order')).toBe(true);
    expect(ids('community').has('task.permissions')).toBe(true);
    expect(ids('community').has('task.volunteer-roster')).toBe(true);
    expect(ids('wedding').has('task.volunteer-roster')).toBe(false);
    expect(
      PRESETS.map((id) => PLANNING_CONFIGURATION.types[id].planningHorizonDays),
    ).toEqual([90, 14, 30]);
  });

  it('explain every allocation, expense, task and recommendation with this event’s facts', () => {
    for (const id of PRESETS) {
      const p = plans[id];
      for (const c of p.budgetCategories)
        expect(c.rationale).toMatch(/% of the pool shared by weight/);
      for (const e of p.expenses) expect(e.rationale?.length).toBeGreaterThan(10);
      for (const t of p.tasks) expect(t.rationale).toMatch(/Due |follow-up|event day/);
      for (const r of p.recommendations) {
        expect(r.because.length).toBeGreaterThan(0);
        expect(r.detail.length).toBeGreaterThan(20);
      }
      expect(p.notes[0]).toMatch(/fictional/i);
    }
    const community = plans.community.recommendations;
    const outdoor = community.find((r) => r.kind === 'outdoor');
    expect(outdoor?.detail).toContain('Satara');
    expect(outdoor?.detail).toContain('does not predict the weather');
    expect(community.find((r) => r.kind === 'accessibility')?.because.join()).toContain(
      'wheelchair access',
    );
    expect(
      plans.wedding.recommendations.find((r) => r.kind === 'dietary')?.because.join(),
    ).toContain('200 guests');
    expect(
      plans.birthday.recommendations.find((r) => r.kind === 'age')?.because.join(),
    ).toContain('30-49');
  });

  it('produce items that are valid and apply cleanly to the record', () => {
    for (const id of PRESETS) {
      const record = preset(id);
      const ops = reconcileOperations(record, plans[id]);
      expect(ops.length).toBeGreaterThan(0);
      const applied = tryApplyOperations(record, ops);
      expect(applied.ok).toBe(true);
      if (!applied.ok) continue;
      expect(applied.record.tasks.length).toBe(plans[id].tasks.length);
      // Applying again changes nothing: the plan is already reconciled.
      const again = reconcileOperations(applied.record, plan(applied.record));
      expect(again).toEqual([]);
    }
  });

  it('keep every dependency inside the plan and never schedule preparation after the event', () => {
    for (const id of PRESETS) {
      const p = plans[id];
      const record = preset(id);
      const ids = new Set(p.tasks.map((t) => t.id));
      for (const t of p.tasks) {
        for (const dep of t.dependsOn ?? []) expect(ids.has(dep)).toBe(true);
        if (t.kind === 'preparation') expect(t.dueDate <= record.profile.date).toBe(true);
        expect(t.dueDate >= TODAY).toBe(true);
      }
    }
  });
});

describe('determinism and stable ids', () => {
  it('identical input yields identical core output', () => {
    for (const id of PRESETS) {
      const record = preset(id);
      const a = plan(record);
      const b = plan(structuredClone(record));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('does not mutate its input', () => {
    const record = preset('wedding');
    const snapshot = structuredClone(record);
    plan(record);
    expect(record).toEqual(snapshot);
  });

  it('task, category and expense ids survive changes to guests, budget and date', () => {
    const base = plan(preset('wedding'));
    const changed = plan(
      withProfile(preset('wedding'), {
        guestCount: 120,
        budgetPaise: 80_000_000,
        date: addDays(TODAY, 120),
      }),
    );
    const idsOf = (p: GeneratedPlan) => ({
      tasks: p.tasks.map((t) => t.id),
      categories: p.budgetCategories.map((c) => c.id),
      expenses: p.expenses.map((e) => e.id),
    });
    expect(idsOf(changed)).toEqual(idsOf(base));
    expect(base.tasks[0]?.id).toBe('event-wedding~task.set-budget');
  });
});

describe('money rules', () => {
  it('the reserve is 10% by default and editable; targets plus reserve always equal the budget', () => {
    for (const basisPoints of [0, 500, 1000, 2500, 5000]) {
      const record = withProfile(preset('wedding'), { reserveBasisPoints: basisPoints });
      const p = plan(record);
      expect(p.reserve.basisPoints).toBe(basisPoints);
      expect(p.reserve.paise).toBe(
        Math.floor((record.profile.budgetPaise * basisPoints) / 10_000),
      );
      expect(sum(p.allocation.targets.map((t) => t.targetPaise)) + p.reserve.paise).toBe(
        record.profile.budgetPaise,
      );
      expect(p.reserve.isDefault).toBe(false);
      expect(p.reserve.explanation).toContain('as you chose');
    }
    expect(plan(preset('wedding')).reserve.explanation).toContain('the default');
  });

  it('allocates in the 10,001 paise pattern: odd paise land by largest remainder, never lost', () => {
    const record = withProfile(preset('birthday'), { budgetPaise: 10_001 });
    const p = plan(record);
    expect(p.reserve.paise).toBe(1000);
    expect(sum(p.allocation.targets.map((t) => t.targetPaise))).toBe(9001);
  });

  it('user priorities raise the matching target, and the plan stays balanced', () => {
    const none = plan(withPreferences(preset('wedding'), { priorities: [] }));
    const venue = plan(withPreferences(preset('wedding'), { priorities: ['venue'] }));
    const target = (p: GeneratedPlan, id: string) =>
      p.budgetCategories.find((c) => c.templateId === id)?.plannedPaise ?? 0;
    expect(target(venue, 'category.venue')).toBeGreaterThan(
      target(none, 'category.venue'),
    );
    expect(target(venue, 'category.food')).toBeLessThan(target(none, 'category.food'));
    expect(venue.allocation.balanced).toBe(true);
    expect(
      venue.budgetCategories.find((c) => c.templateId === 'category.venue')?.rationale,
    ).toContain('raised 30% for your venue priority');
    expect(venue.recommendations.some((r) => r.kind === 'priorities')).toBe(true);
    expect(none.recommendations.some((r) => r.kind === 'priorities')).toBe(false);
  });

  it('increasing guests changes per-guest forecasts; fixed costs stay unchanged', () => {
    const small = plan(withProfile(preset('wedding'), { guestCount: 120 }));
    const large = plan(withProfile(preset('wedding'), { guestCount: 180 }));
    expect(forecastOf(small, 'expense.catering')).toBe(120 * 45_000);
    expect(forecastOf(large, 'expense.catering')).toBe(180 * 45_000);
    expect(forecastOf(small, 'expense.venue-hire')).toBe(
      forecastOf(large, 'expense.venue-hire'),
    );
    expect(forecastOf(small, 'expense.decor')).toBe(forecastOf(large, 'expense.decor'));
    expect(large.forecast.forecastPaise - small.forecast.forecastPaise).toBe(
      large.forecast.perGuestPaise * 60,
    );
  });

  it('forecast does not depend on the budget: a smaller budget cannot make the plan cheaper', () => {
    const rich = plan(withProfile(preset('wedding'), { budgetPaise: 50_000_000 }));
    const poor = plan(withProfile(preset('wedding'), { budgetPaise: 20_000_000 }));
    expect(poor.forecast.forecastPaise).toBe(rich.forecast.forecastPaise);
    expect(poor.expenses).toEqual(rich.expenses);
  });

  it('an infeasible budget gives an explicit conflict, a numerical shortfall and options', () => {
    const record = withProfile(preset('wedding'), { budgetPaise: 40_000_000 });
    const p = plan(record);
    const shortfall = p.forecast.forecastPaise - record.profile.budgetPaise;
    expect(shortfall).toBeGreaterThan(0);
    const conflict = p.conflicts.find((c) => c.kind === 'forecast-exceeds-budget');
    expect(conflict).toMatchObject({ severity: 'critical', amountPaise: shortfall });
    expect(p.options.map((o) => o.kind)).toEqual([
      'drop-optional',
      'reduce-guests',
      'raise-budget',
    ]);

    // The guest option is exact: that many guests fit, one more does not.
    const guests = p.options.find((o) => o.kind === 'reduce-guests');
    const fits = plan(withProfile(record, { guestCount: guests?.guestCount ?? 0 }));
    const over = plan(withProfile(record, { guestCount: (guests?.guestCount ?? 0) + 1 }));
    expect(fits.forecast.forecastPaise).toBeLessThanOrEqual(
      fits.allocation.spendablePaise,
    );
    expect(over.forecast.forecastPaise).toBeGreaterThan(over.allocation.spendablePaise);

    expect(p.recommendations.find((r) => r.kind === 'budget')?.title).toBe(
      'The forecast is over budget',
    );
    // The targets are still balanced, and still do not make the plan affordable.
    expect(p.allocation.balanced).toBe(true);
  });

  it('says so when fixed costs alone cannot fit, and does not offer fewer guests as a fix', () => {
    const p = plan(withProfile(preset('wedding'), { budgetPaise: 20_000_000 }));
    expect(
      p.conflicts.find((c) => c.kind === 'forecast-exceeds-budget')?.message,
    ).toContain('Fixed costs alone');
    expect(p.options.some((o) => o.kind === 'reduce-guests')).toBe(false);
    expect(p.options.some((o) => o.kind === 'raise-budget')).toBe(true);
  });

  it('keeps a locked user target and shares the rest around it', () => {
    const record = preset('wedding');
    const venueId = `${record.profile.id}~category.venue`;
    const withLock: EventRecord = {
      ...record,
      budgetCategories: [
        {
          id: venueId,
          templateId: 'category.venue',
          name: 'Venue',
          plannedPaise: 12_000_000,
          plannedOrigin: 'user',
        },
      ],
    };
    const p = plan(withLock);
    const venue = p.budgetCategories.find((c) => c.templateId === 'category.venue');
    expect(venue).toMatchObject({ plannedPaise: 12_000_000, plannedOrigin: 'user' });
    expect(venue?.rationale).toContain('Fixed by you');
    expect(sum(p.allocation.targets.map((t) => t.targetPaise)) + p.reserve.paise).toBe(
      record.profile.budgetPaise,
    );
  });

  it('reports locked targets that cannot fit', () => {
    const record = preset('birthday');
    const p = plan({
      ...record,
      budgetCategories: [
        {
          id: 'custom-1',
          name: 'Custom',
          plannedPaise: record.profile.budgetPaise,
          plannedOrigin: 'user',
        },
      ],
    });
    expect(p.allocation.balanced).toBe(false);
    expect(p.conflicts.some((c) => c.kind === 'locked-targets-exceed-spendable')).toBe(
      true,
    );
  });
});

describe('required provisions are never silently removed', () => {
  it('adds a required, protected expense for each stated accessibility need and nothing otherwise', () => {
    const none = plan(preset('birthday'));
    expect(none.expenses.some((e) => e.requirement)).toBe(false);
    expect(none.budgetCategories.some((c) => c.templateId === 'category.access')).toBe(
      false,
    );

    const needs = plan(
      withPreferences(preset('birthday'), {
        accessibilityNeeds: ['wheelchair-access', 'sign-language', 'seating-areas'],
      }),
    );
    const required = needs.expenses.filter(
      (e) => e.requirement && e.requirement !== 'dietary',
    );
    expect(required.map((e) => e.requirement).sort()).toEqual([
      'seating-areas',
      'sign-language',
      'wheelchair-access',
    ]);
    expect(
      needs.tasks.some(
        (t) => t.templateId === 'task.check-access' && t.importance === 'critical',
      ),
    ).toBe(true);
  });

  it('reserves the cost of required items inside the accessibility target, even for a tiny weight', () => {
    const community = plan(preset('community'));
    const access = community.allocation.targets.find((t) =>
      t.id.endsWith('category.access'),
    );
    const rampCost = forecastOf(community, 'expense.wheelchair-ramps') ?? 0;
    expect(rampCost).toBeGreaterThan(0);
    expect(access?.floorPaise).toBe(rampCost);
    expect(access?.targetPaise).toBeGreaterThanOrEqual(rampCost);
    expect(
      community.recommendations.find((r) => r.kind === 'accessibility')?.detail,
    ).toContain('never offered as savings');
  });

  it('stated dietary needs add a protected meal provision and a confirmation task', () => {
    const wedding = plan(preset('wedding')); // vegetarian
    const item = wedding.expenses.find(
      (e) => e.templateId === 'expense.dietary-provision',
    );
    expect(item).toMatchObject({
      requirement: 'dietary',
      estimate: { basis: 'per-guest', perGuestPaise: 3000 },
    });
    expect(wedding.tasks.some((t) => t.templateId === 'task.dietary-menu')).toBe(true);
    const birthday = plan(preset('birthday'));
    expect(
      birthday.expenses.some((e) => e.templateId === 'expense.dietary-provision'),
    ).toBe(false);
  });

  it('even in a budget crisis, required items are not among the suggested savings', () => {
    const record = withProfile(
      withPreferences(preset('community'), {
        dietaryNeeds: ['vegan'],
        accessibilityNeeds: ['wheelchair-access', 'accessible-restrooms'],
      }),
      { budgetPaise: 5_000_000 },
    );
    const p = plan(record);
    const required = new Set(p.expenses.filter((e) => e.requirement).map((e) => e.id));
    expect(required.size).toBeGreaterThan(0);
    for (const option of p.options) {
      for (const id of option.expenseIds ?? []) expect(required.has(id)).toBe(false);
    }
    expect(p.expenses.filter((e) => e.requirement).length).toBe(required.size); // still in the plan
  });

  it('reports required items that cannot fit instead of dropping them', () => {
    const record = withProfile(
      withPreferences(preset('community'), {
        accessibilityNeeds: [
          'wheelchair-access',
          'accessible-restrooms',
          'sign-language',
        ],
      }),
      { budgetPaise: 3_000_000 },
    );
    const p = plan(record);
    expect(p.conflicts.some((c) => c.kind === 'required-floors-exceed-spendable')).toBe(
      true,
    );
    expect(p.expenses.filter((e) => e.requirement).length).toBe(3);
  });
});

describe('dates and schedule', () => {
  it('on the usual schedule when there is time', () => {
    const p = plan(preset('wedding'));
    expect(p.schedule.compressed).toBe(false);
    expect(p.tasks.find((t) => t.templateId === 'task.set-budget')).toMatchObject({
      dueDate: TODAY,
      idealDueDate: TODAY,
    });
    expect(p.recommendations.some((r) => r.kind === 'schedule')).toBe(false);
  });

  it('preserves ideal deadlines when normal lead time has passed, and explains the compressed schedule', () => {
    const record = withProfile(preset('wedding'), { date: addDays(TODAY, 30) });
    const p = plan(record);
    const budget = p.tasks.find((t) => t.templateId === 'task.set-budget');
    expect(budget?.idealDueDate).toBe(addDays(record.profile.date, -90)); // kept, in the past
    expect(budget?.dueDate).toBe(TODAY); // immediate catch-up
    expect(budget?.rationale).toContain('immediate catch-up');
    expect(p.schedule).toMatchObject({ compressed: true, daysUntilEvent: 30 });
    expect(p.schedule.explanation).toContain('past their usual deadline');

    const catchUp = p.recommendations.find((r) => r.id === 'recommendation.catch-up');
    expect(catchUp?.because.join()).toContain('30 days until');
    expect(catchUp?.taskIds?.length).toBeGreaterThan(0);

    for (const t of p.tasks) {
      expect(t.dueDate >= TODAY).toBe(true);
      if (t.kind === 'preparation') expect(t.dueDate <= record.profile.date).toBe(true);
    }
    // Follow-ups are explicitly after the event.
    const thanks = p.tasks.find((t) => t.templateId === 'task.thank-you');
    expect(thanks?.dueDate).toBe(addDays(record.profile.date, 7));
  });

  it('never schedules preparation after the event, for any amount of time left', () => {
    for (const id of PRESETS) {
      for (let daysLeft = 0; daysLeft <= 120; daysLeft += 1) {
        const record = withProfile(preset(id), { date: addDays(TODAY, daysLeft) });
        const p = plan(record);
        for (const t of p.tasks) {
          expect(t.dueDate >= TODAY).toBe(true);
          if (t.kind === 'preparation')
            expect(t.dueDate <= record.profile.date).toBe(true);
          for (const dep of t.dependsOn ?? []) {
            const depTask = p.tasks.find((x) => x.id === dep);
            expect(depTask && depTask.dueDate <= t.dueDate).toBe(true);
          }
        }
      }
    }
  }, 30_000);

  it('today and tomorrow: schedules everything inside the remaining window', () => {
    const today = plan(withProfile(preset('birthday'), { date: TODAY }));
    expect(today.status).toBe('event-day');
    for (const t of today.tasks.filter((x) => x.kind === 'preparation'))
      expect(t.dueDate).toBe(TODAY);

    const tomorrow = plan(withProfile(preset('birthday'), { date: addDays(TODAY, 1) }));
    expect(tomorrow.status).toBe('upcoming');
    for (const t of tomorrow.tasks.filter((x) => x.kind === 'preparation')) {
      expect(t.dueDate >= TODAY && t.dueDate <= addDays(TODAY, 1)).toBe(true);
    }
  });

  it('month-end and leap-day dates are computed on the calendar', () => {
    const leap = plan(
      withProfile(preset('birthday'), { date: '2028-03-01' }),
      '2028-02-01',
    );
    expect(
      leap.tasks.find((t) => t.templateId === 'task.confirm-rsvps')?.idealDueDate,
    ).toBe('2028-02-26'); // 4 days before
    expect(
      leap.tasks.find((t) => t.templateId === 'task.final-shopping')?.idealDueDate,
    ).toBe('2028-02-28');
    expect(leap.tasks.find((t) => t.templateId === 'task.thank-you')?.dueDate).toBe(
      '2028-03-04',
    );
    const monthEnd = plan(
      withProfile(preset('birthday'), { date: '2026-11-01' }),
      '2026-10-01',
    );
    expect(
      monthEnd.tasks.find((t) => t.templateId === 'task.final-shopping')?.idealDueDate,
    ).toBe('2026-10-30');
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('treats an event that has already happened as history', () => {
    const record = withProfile(preset('wedding'), { date: addDays(TODAY, -3) });
    const p = plan(record);
    expect(p.status).toBe('history');
    expect(p.tasks).toEqual([]);
    expect(p.budgetCategories).toEqual([]);
    expect(p.expenses).toEqual([]);
    expect(p.recommendations).toEqual([]);
    expect(p.conflicts.map((c) => c.kind)).toEqual(['event-in-history']);
    expect(reconcileOperations(record, p)).toEqual([]); // history is never rewritten
  });

  it('rejects an invalid today', () => {
    expect(() =>
      generatePlan(preset('wedding'), PLANNING_CONFIGURATION, '2026-02-30'),
    ).toThrow(RangeError);
  });
});

describe('recommendations stay within what the user stated', () => {
  it('adds outdoor backup tasks only for outdoor or mixed settings, without any weather forecast', () => {
    const indoor = plan(preset('wedding'));
    expect(indoor.tasks.some((t) => t.templateId === 'task.weather-backup')).toBe(false);
    expect(indoor.expenses.some((e) => e.templateId === 'expense.weather-cover')).toBe(
      false,
    );

    for (const setting of ['outdoor', 'mixed'] as const) {
      const p = plan(withProfile(preset('wedding'), { setting }));
      const task = p.tasks.find((t) => t.templateId === 'task.weather-backup');
      expect(task?.rationale).toContain('does not predict weather');
      expect(p.expenses.some((e) => e.templateId === 'expense.weather-cover')).toBe(true);
      const rec = p.recommendations.find((r) => r.kind === 'outdoor');
      expect(rec?.because).toEqual(
        expect.arrayContaining([`Setting: ${setting}`, 'City: Pune']),
      );
      const text = JSON.stringify([task, rec]).toLowerCase();
      expect(text).not.toMatch(
        /forecast(ed)? (rain|storm|weather)|chance of|% chance|rain expected|monsoon/,
      );
    }
  });

  it('introduces cultural practices only when the user typed them', () => {
    const base = plan(withProfile(preset('wedding'), { city: 'Varanasi' }));
    expect(base.tasks.some((t) => t.templateId?.includes('cultural'))).toBe(false);
    expect(base.ideas.some((i) => i.tags?.includes('cultural'))).toBe(false);
    expect(base.recommendations.some((r) => r.kind === 'cultural')).toBe(false);

    const asked = plan(
      withPreferences(preset('wedding'), {
        culturalPreferences: ['Haldi evening', 'हळद', 'haldi  evening!'],
      }),
    );
    const cultural = asked.tasks.filter((t) =>
      t.templateId?.startsWith('task.cultural.'),
    );
    expect(cultural).toHaveLength(2); // the third entry is the same as the first
    expect(cultural[0]?.title).toBe('Plan how to include: Haldi evening');
    expect(cultural[0]?.rationale).toContain(
      'does not add practices you did not ask for',
    );
    expect(asked.ideas.filter((i) => i.tags?.includes('cultural'))).toHaveLength(2);
    expect(asked.recommendations.find((r) => r.kind === 'cultural')?.because).toEqual([
      'You listed: Haldi evening',
      'You listed: हळद',
      'You listed: haldi  evening!',
    ]);
    // Nothing else changes because of them.
    expect(asked.expenses).toEqual(base.expenses);
  });

  it('gives user-typed entries stable keys, even without ASCII letters', () => {
    expect(entryKey('Haldi evening')).toBe('haldi-evening');
    expect(entryKey('हळद')).toBe(entryKey('हळद'));
    expect(entryKey('हळद')).toMatch(/^c[0-9a-z]+$/);
    expect(entryKey('हळद')).not.toBe(entryKey('मेहंदी'));
  });

  it('flags a small reserve and a dominant per-guest cost with this event’s numbers', () => {
    const p = plan(withProfile(preset('birthday'), { reserveBasisPoints: 200 }));
    const reserve = p.recommendations.find((r) => r.kind === 'reserve');
    expect(reserve?.detail).toContain('2%');
    const guests = p.recommendations.find((r) => r.kind === 'guests');
    expect(guests?.because.join()).toContain('40 guests');
    expect(
      plan(
        withProfile(preset('birthday'), { reserveBasisPoints: 0 }),
      ).recommendations.find((r) => r.kind === 'reserve')?.title,
    ).toBe('There is no contingency reserve');
  });

  it('matches birthday activities to a stated age band and never asks for a birth date', () => {
    const child = plan(withProfile(preset('birthday'), { ageBand: 'under-13' }));
    expect(child.expenses.some((e) => e.templateId === 'expense.kids-activities')).toBe(
      true,
    );
    expect(child.tasks.some((t) => t.templateId === 'task.age-activities')).toBe(true);
    expect(child.ideas.some((i) => i.templateId === 'idea.birthday-craft-table')).toBe(
      true,
    );
    const adult = plan(preset('birthday')); // 30-49
    expect(adult.expenses.some((e) => e.templateId === 'expense.kids-activities')).toBe(
      false,
    );
    const senior = plan(withProfile(preset('birthday'), { ageBand: '65-plus' }));
    expect(senior.ideas.some((i) => i.templateId === 'idea.birthday-seated-lounge')).toBe(
      true,
    );
  });

  it('fills vendor checklists with the actual guest count, city and date', () => {
    const p = plan(preset('wedding'));
    const venue = p.vendorChecklists.find((c) => c.id === 'checklist.venue');
    expect(venue?.items.join('\n')).toContain('200 guests');
    expect(venue?.items.join('\n')).toContain('Pune');
    expect(venue?.items.join('\n')).not.toMatch(/\{guests\}|\{city\}|\{date\}/);
    const outdoor = plan(
      withProfile(preset('wedding'), { setting: 'outdoor' }),
    ).vendorChecklists.find((c) => c.id === 'checklist.venue');
    expect(outdoor?.items.length).toBe((venue?.items.length ?? 0) + 1);
  });
});
