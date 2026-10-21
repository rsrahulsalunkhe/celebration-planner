import { describe, expect, it } from 'vitest';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { TODAY, presetEvent, task, withProfile } from '@/test/helpers.ts';
import { addDays } from '../dates.ts';
import { applyOperations } from '../editEvent.ts';
import { runOrderItemSchema } from '../schemas.ts';
import type {
  ChangeOperation,
  EventRecord,
  PlanningTask,
  Preferences,
} from '../types.ts';
import { buildRunOrder } from './runOrder.ts';
import {
  NO_FILTERS,
  buildTimeline,
  filterTimeline,
  groupByPhase,
  keepDeadlineOperation,
  ownersOf,
  plannedDeadlineOperation,
  setDeadlineOperation,
  startingTimelineOperations,
  statusOperation,
  withTimelineRegeneration,
} from './timeline.ts';
import type { PlanningConfiguration } from './types.ts';

const CONFIG = PLANNING_CONFIGURATION;

function apply(record: EventRecord, operations: readonly ChangeOperation[]): EventRecord {
  const next = applyOperations(record, operations);
  if (!next) throw new Error('operations did not apply');
  return next;
}

function withTimeline(
  id: 'wedding' | 'birthday' | 'community',
  preferences?: Partial<Preferences>,
  profile: Partial<EventRecord['profile']> = {},
): EventRecord {
  let record = presetEvent(id);
  record = {
    ...withProfile(record, profile),
    preferences: { ...record.preferences, ...preferences },
  };
  return apply(record, startingTimelineOperations(record, CONFIG, TODAY));
}

const byTemplate = (record: EventRecord, templateId: string): PlanningTask => {
  const found = record.tasks.find((t) => t.templateId === templateId);
  if (!found) throw new Error(`no task ${templateId}`);
  return found;
};
const templates = (record: EventRecord) => new Set(record.tasks.map((t) => t.templateId));

describe('moving an event from 90 days ahead to five days ahead (completion check)', () => {
  function scenario() {
    let record = withTimeline('wedding');
    expect(record.profile.date).toBe(addDays(TODAY, 90));
    const budget = byTemplate(record, 'task.set-budget');
    const guests = byTemplate(record, 'task.guest-list');
    const photos = byTemplate(record, 'task.book-photographer');
    record = apply(record, [
      statusOperation(budget, 'done'),
      statusOperation(guests, 'done'),
      {
        op: 'tasks/upsert',
        item: { ...photos, notes: 'Ask about drone shots', owner: 'Asha' },
      },
      setDeadlineOperation(
        byTemplate(record, 'task.attire'),
        addDays(TODAY, 40),
        record.profile.date,
      ),
      {
        op: 'tasks/upsert',
        item: task('custom-1', {
          title: 'Book the mehendi artist',
          dueDate: addDays(TODAY, 60),
          kind: 'preparation',
          category: 'suppliers',
          owner: 'Ravi',
          notes: 'Two quotes so far',
        }),
      },
    ]);
    const before = record;
    const fiveDays = addDays(TODAY, 5);
    const edit = withTimelineRegeneration(
      before,
      [{ op: 'profile/patch', patch: { date: fiveDays } }],
      CONFIG,
      TODAY,
    );
    const after = apply(before, edit.operations);
    return { before, after, edit, fiveDays };
  }

  it('recomputes generated deadlines into the time that is left', () => {
    const { after, edit, fiveDays } = scenario();
    expect(edit.moved).toBeGreaterThan(5);
    for (const t of after.tasks) {
      if (t.dueDateOrigin !== 'generated' || t.status === 'done') continue;
      if (t.kind === 'preparation') {
        expect(t.dueDate >= TODAY).toBe(true);
        expect(t.dueDate <= fiveDays).toBe(true);
      }
      if (t.kind === 'event-day') expect(t.dueDate).toBe(fiveDays);
    }
    // The usual deadline is kept for reference, counted back from the new date.
    expect(byTemplate(after, 'task.book-venue').idealDueDate).toBe(
      addDays(fiveDays, -80),
    );
  });

  it('keeps completed work, custom tasks, notes, owners and manual deadlines', () => {
    const { before, after } = scenario();
    for (const id of ['task.set-budget', 'task.guest-list']) {
      expect(byTemplate(after, id)).toMatchObject({
        status: 'done',
        dueDate: byTemplate(before, id).dueDate,
      });
    }
    expect(after.tasks.find((t) => t.id === 'custom-1')).toEqual(
      before.tasks.find((t) => t.id === 'custom-1'),
    );
    expect(byTemplate(after, 'task.book-photographer')).toMatchObject({
      notes: 'Ask about drone shots',
      owner: 'Asha',
    });
    expect(byTemplate(after, 'task.attire')).toMatchObject({
      dueDate: addDays(TODAY, 40),
      dueDateOrigin: 'user',
    });
  });

  it('flags the outdated manual deadline for review instead of moving it', () => {
    const { after, edit } = scenario();
    expect(edit.flagged).toBe(2); // the attire override and the custom task's deadline
    const timeline = buildTimeline(after, TODAY, CONFIG);
    const attire = timeline.items.find((i) => i.task.templateId === 'task.attire');
    expect(attire?.overrideOutdated).toBe(true);
    expect(attire?.overrideProblem).toMatch(
      /You set this deadline when the event was on/,
    );
    const kept = apply(after, [
      keepDeadlineOperation(byTemplate(after, 'task.attire'), after.profile.date),
    ]);
    const reviewed = buildTimeline(kept, TODAY, CONFIG).items.find(
      (i) => i.task.templateId === 'task.attire',
    );
    // Still after the event, so it stays flagged for that reason.
    expect(reviewed?.overrideProblem).toMatch(/after the event/);
    const planned = plannedDeadlineOperation(
      after,
      byTemplate(after, 'task.attire'),
      CONFIG,
      TODAY,
    );
    if (!planned) throw new Error('expected a planned date');
    const reverted = apply(after, [planned]);
    expect(byTemplate(reverted, 'task.attire')).toMatchObject({
      dueDateOrigin: 'generated',
    });
    expect(byTemplate(reverted, 'task.attire').dueDateSetFor).toBeUndefined();
  });

  it('creates useful urgency with catch-up advice that keeps the original deadline', () => {
    const { after } = scenario();
    const timeline = buildTimeline(after, TODAY, CONFIG);
    const venue = timeline.items.find((i) => i.task.templateId === 'task.book-venue');
    expect(venue?.behindIdeal).toBe(true);
    expect(venue?.catchUp?.originalDeadline).toBe(addDays(after.profile.date, -80));
    expect(venue?.catchUp?.recommendation).toMatch(/Catch up now: this step is critical/);
    expect(venue?.catchUp?.problem).toMatch(
      /usually needs 80 days before the event.*Only 5 days are left/,
    );
    expect(
      timeline.items.filter((i) => i.urgency === 'due-today').length,
    ).toBeGreaterThan(0);
    expect(timeline.items.filter((i) => i.urgency === 'due-soon').length).toBeGreaterThan(
      0,
    );

    const { health } = timeline;
    expect(health.catchUpCapacity).toBe(10);
    expect(health.catchUpCount).toBeGreaterThan(10);
    expect(health.overloaded).toBe(true);
    expect(health.messages.join(' ')).toMatch(
      /Moving every deadline to today would not make this schedule feasible/,
    );
  });

  it('does not overstate trouble when the event stays 90 days ahead', () => {
    const health = buildTimeline(withTimeline('wedding'), TODAY, CONFIG).health;
    expect(health.catchUpCount).toBe(0);
    expect(health.overloaded).toBe(false);
    expect(health.messages).toEqual([
      'Every open step is on its usual schedule with 90 days to go.',
    ]);
  });
});

describe('same-day and past events', () => {
  it('a same-day event is usable: event-day tasks are due today', () => {
    const record = withTimeline('birthday');
    const today = apply(
      record,
      withTimelineRegeneration(
        record,
        [{ op: 'profile/patch', patch: { date: TODAY } }],
        CONFIG,
        TODAY,
      ).operations,
    );
    const timeline = buildTimeline(today, TODAY, CONFIG);
    expect(timeline.health.status).toBe('event-day');
    const setUp = timeline.items.find((i) => i.task.templateId === 'task.set-up-party');
    expect(setUp).toMatchObject({ kind: 'event-day', urgency: 'due-today' });
    expect(timeline.health.messages[0]).toMatch(/The event is today/);
  });

  it('a past event keeps its tasks as history and can still be edited', () => {
    const record = withTimeline('community');
    const past = withProfile(record, { date: addDays(TODAY, -3) });
    const timeline = buildTimeline(past, TODAY, CONFIG);
    expect(timeline.health.status).toBe('history');
    expect(timeline.health.overloaded).toBe(false);
    expect(timeline.items.every((i) => i.catchUp === null)).toBe(true);
    expect(timeline.health.messages[0]).toMatch(/kept as history/);
    // History is not rewritten.
    const regenerated = withTimelineRegeneration(past, [], CONFIG, TODAY);
    expect(regenerated.operations).toEqual([]);
    // Follow-ups can still be completed.
    const thanks = byTemplate(past, 'task.thank-volunteers');
    const done = apply(past, [statusOperation(thanks, 'done')]);
    expect(byTemplate(done, 'task.thank-volunteers').status).toBe('done');
    expect(plannedDeadlineOperation(past, thanks, CONFIG, TODAY)).toBeNull();
  });
});

describe('phases, blockers and filters', () => {
  it('separates preparation, event-day and follow-up tasks', () => {
    const timeline = buildTimeline(withTimeline('community'), TODAY, CONFIG);
    const kinds = new Set(timeline.items.map((i) => i.kind));
    expect(kinds).toEqual(new Set(['preparation', 'event-day', 'follow-up']));
    const groups = groupByPhase(timeline.items);
    expect(groups.map((g) => g.phase)).toEqual([
      'final-month',
      'final-week',
      'event-day',
      'follow-up',
    ]);
    for (const g of groups) {
      const dates = g.items.map((i) => i.task.dueDate);
      expect(dates).toEqual([...dates].sort());
    }
  });

  it('shows blockers and never completes prerequisites as a side effect', () => {
    const record = withTimeline('wedding');
    const venue = byTemplate(record, 'task.book-venue');
    const item = buildTimeline(record, TODAY, CONFIG).items.find(
      (i) => i.task.id === venue.id,
    );
    expect(item?.blockers.map((b) => b.title)).toEqual([
      'Confirm the total budget and reserve',
      'Draft the guest list',
    ]);
    const next = apply(record, [statusOperation(venue, 'done')]);
    expect(byTemplate(next, 'task.set-budget').status).toBe('todo');
    expect(byTemplate(next, 'task.guest-list').status).toBe('todo');
  });

  it('filters by status, category, urgency and owner', () => {
    let record = withTimeline('community');
    const roster = byTemplate(record, 'task.volunteer-roster');
    record = apply(record, [
      { op: 'tasks/upsert', item: { ...roster, owner: 'Meera', status: 'done' } },
    ]);
    const { items } = buildTimeline(record, TODAY, CONFIG);
    const ids = (f: Partial<typeof NO_FILTERS>) =>
      filterTimeline(items, { ...NO_FILTERS, ...f }).map((i) => i.task.templateId);
    expect(ids({ status: 'done' })).toEqual(['task.volunteer-roster']);
    expect(ids({ status: 'open' })).not.toContain('task.volunteer-roster');
    expect(ids({ owner: 'Meera' })).toEqual(['task.volunteer-roster']);
    expect(ids({ owner: 'unassigned' })).not.toContain('task.volunteer-roster');
    expect(ids({ category: 'wrap-up' }).sort()).toEqual(
      ['task.cleanup', 'task.report-expenses', 'task.thank-volunteers'].sort(),
    );
    expect(ids({ urgency: 'blocked' })).toContain('task.book-site');
    expect(ids({ urgency: 'upcoming' }).length).toBeGreaterThan(0);
    expect(ownersOf(record.tasks)).toEqual(['Meera']);
  });
});

describe('configuration and dependency errors', () => {
  it('surfaces missing and cyclic dependencies in the planning rules', () => {
    const wedding = CONFIG.types.wedding;
    const broken: PlanningConfiguration = {
      ...CONFIG,
      types: {
        ...CONFIG.types,
        wedding: {
          ...wedding,
          tasks: [
            ...wedding.tasks,
            {
              id: 'task.loop-a',
              title: 'A',
              timing: { kind: 'before', days: 10 },
              importance: 'routine',
              category: 'planning',
              dependsOn: ['task.loop-b'],
              rationale: 'r',
            },
            {
              id: 'task.loop-b',
              title: 'B',
              timing: { kind: 'before', days: 10 },
              importance: 'routine',
              category: 'planning',
              dependsOn: ['task.loop-a', 'task.missing'],
              rationale: 'r',
            },
          ],
        },
      },
    };
    const errors = buildTimeline(
      presetEvent('wedding'),
      TODAY,
      broken,
    ).configurationErrors;
    expect(errors.join(' ')).toMatch(/unknown task task\.missing/);
    expect(errors.join(' ')).toMatch(/cycle/);
    expect(
      buildTimeline(presetEvent('birthday'), TODAY, broken).configurationErrors,
    ).toEqual([]);
  });

  it('reports a loop or a missing prerequisite in saved tasks without crashing', () => {
    const record = presetEvent('birthday');
    const unchecked: EventRecord = {
      ...record,
      tasks: [
        task('a', { title: 'A', dependsOn: ['b'] }),
        task('b', { title: 'B', dependsOn: ['a'] }),
        task('c', { title: 'C', dependsOn: ['gone'] }),
      ],
    };
    const errors = buildTimeline(unchecked, TODAY, CONFIG).dependencyErrors;
    expect(errors.join(' ')).toMatch(/depend on each other in a loop/);
    expect(errors.join(' ')).toMatch(/“C” depends on a task that does not exist/);
  });
});

describe('regeneration keeps what the user wrote', () => {
  it('keeps a no-longer-applicable generated task that has notes', () => {
    let record = withTimeline('wedding');
    const menu = byTemplate(record, 'task.dietary-menu');
    record = apply(record, [
      { op: 'tasks/upsert', item: { ...menu, notes: 'Jain options' } },
    ]);
    const edit = withTimelineRegeneration(
      record,
      [
        {
          op: 'preferences/set',
          preferences: { ...record.preferences, dietaryNeeds: [] },
        },
      ],
      CONFIG,
      TODAY,
    );
    const next = apply(record, edit.operations);
    expect(next.tasks.find((t) => t.id === menu.id)?.notes).toBe('Jain options');
  });

  it('does nothing extra for an event without a generated timeline', () => {
    const record = presetEvent('wedding');
    const base: ChangeOperation[] = [{ op: 'profile/patch', patch: { city: 'Mumbai' } }];
    expect(withTimelineRegeneration(record, base, CONFIG, TODAY).operations).toEqual(
      base,
    );
  });
});

describe('personalised tasks', () => {
  it('community events include volunteer, access, cleanup and backup checks', () => {
    const plain = templates(withTimeline('community', { accessibilityNeeds: [] }));
    for (const id of [
      'task.volunteer-roster',
      'task.access-basics',
      'task.cleanup',
      'task.backup-plan',
    ])
      expect(plain.has(id)).toBe(true);
    expect(plain.has('task.check-access')).toBe(false);
    const withNeeds = templates(withTimeline('community'));
    expect(withNeeds.has('task.check-access')).toBe(true);
    expect(withNeeds.has('task.access-basics')).toBe(false);
  });

  it('birthdays get preparation that suits the age band', () => {
    const child = templates(withTimeline('birthday', {}, { ageBand: 'under-13' }));
    expect(child.has('task.child-supervision')).toBe(true);
    expect(child.has('task.child-food-safety')).toBe(true);
    const teen = templates(withTimeline('birthday', {}, { ageBand: '13-17' }));
    expect(teen.has('task.teen-pickup')).toBe(true);
    expect(teen.has('task.child-supervision')).toBe(false);
    const older = templates(withTimeline('birthday', {}, { ageBand: '65-plus' }));
    expect(older.has('task.older-guest-comfort')).toBe(true);
    const adult = templates(withTimeline('birthday'));
    for (const id of [
      'task.child-supervision',
      'task.teen-pickup',
      'task.older-guest-comfort',
    ])
      expect(adult.has(id)).toBe(false);
  });

  it('wedding tasks follow chosen preferences and assume no cultural ceremony', () => {
    const plain = withTimeline('wedding', { priorities: [], culturalPreferences: [] });
    const ids = templates(plain);
    expect(ids.has('task.ceremony-plan')).toBe(false);
    expect(ids.has('task.menu-tasting')).toBe(false);
    expect(plain.tasks.some((t) => t.templateId?.startsWith('task.cultural.'))).toBe(
      false,
    );
    const text = plain.tasks.map((t) => `${t.title} ${t.rationale ?? ''}`).join(' ');
    expect(text).not.toMatch(/mehendi|sangeet|pheras|nikah|vows|church|temple/i);

    const chosen = templates(
      withTimeline('wedding', {
        priorities: ['ceremony', 'food', 'decor', 'entertainment'],
        culturalPreferences: ['Haldi'],
      }),
    );
    for (const id of [
      'task.ceremony-plan',
      'task.menu-tasting',
      'task.decor-plan',
      'task.book-music',
      'task.cultural.haldi',
    ])
      expect(chosen.has(id)).toBe(true);
  });
});

describe('running order', () => {
  const item = (id: string, start: string, end: string) => ({
    id,
    title: id,
    start,
    end,
  });

  it('rejects an end that is not after the start', () => {
    expect(runOrderItemSchema.safeParse(item('a', '10:00', '10:00')).success).toBe(false);
    expect(runOrderItemSchema.safeParse(item('a', '10:00', '09:30')).success).toBe(false);
    expect(runOrderItemSchema.safeParse(item('a', '10:00', '10:01')).success).toBe(true);
    expect(runOrderItemSchema.safeParse(item('a', '24:00', '24:30')).success).toBe(false);
    expect(runOrderItemSchema.safeParse(item('a', '9:00', '10:00')).success).toBe(false);
  });

  it('sorts by time and flags overlapping items', () => {
    const order = buildRunOrder([
      item('dinner', '19:00', '21:00'),
      item('welcome', '17:00', '17:30'),
      item('speeches', '18:45', '19:15'),
      item('photos', '17:30', '18:30'),
    ]);
    expect(order.rows.map((r) => r.item.id)).toEqual([
      'welcome',
      'photos',
      'speeches',
      'dinner',
    ]);
    expect(order.overlaps).toHaveLength(1);
    expect(order.overlaps[0]?.message).toMatch(
      /“speeches” \(18:45–19:15\) and “dinner” \(19:00–21:00\) overlap by 15 min/,
    );
    expect(order.rows.find((r) => r.item.id === 'dinner')?.overlapsWith).toEqual([
      { id: 'speeches', title: 'speeches' },
    ]);
    expect(order.rows.find((r) => r.item.id === 'photos')?.gapBeforeMinutes).toBe(0);
    expect(order.rows.find((r) => r.item.id === 'speeches')?.gapBeforeMinutes).toBe(15);
    expect(order.span).toEqual({ start: '17:00', end: '21:00' });
    expect(buildRunOrder([]).span).toBeNull();
  });

  it('is stored with the event and survives a round trip', () => {
    const record = apply(presetEvent('birthday'), [
      { op: 'runOrder/upsert', item: item('cake', '18:00', '18:15') },
    ]);
    expect(record.runOrder).toHaveLength(1);
    const removed = apply(record, [{ op: 'runOrder/remove', itemId: 'cake' }]);
    expect(removed.runOrder).toEqual([]);
  });
});
