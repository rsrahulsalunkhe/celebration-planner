import { describe, expect, it } from 'vitest';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { TODAY, presetEvent } from '@/test/helpers.ts';
import { addDays } from '../dates.ts';
import { applyOperations } from '../editEvent.ts';
import type { EventRecord, Preferences } from '../types.ts';
import { buildLedger, startingBudgetOperations } from './budget.ts';
import {
  SOURCE_LABELS,
  defaultIdeaFilters,
  draftAlreadySaved,
  ideaFromDraft,
  ideaFromSuggestion,
  ideaTaskId,
  ideaTaskOperations,
  sourceOf,
  suggestIdeas,
  taskPlanFor,
  type IdeaFilters,
} from './ideas.ts';

const CONFIG = PLANNING_CONFIGURATION;

function event(
  id: 'wedding' | 'birthday' | 'community',
  preferences: Partial<Preferences> = {},
  profile: Partial<EventRecord['profile']> = {},
): EventRecord {
  const base = presetEvent(id);
  return {
    ...base,
    profile: { ...base.profile, ...profile },
    preferences: { ...base.preferences, ...preferences },
  };
}
function apply(
  record: EventRecord,
  ops: Parameters<typeof applyOperations>[1],
): EventRecord {
  const next = applyOperations(record, ops);
  if (!next) throw new Error('operations did not apply');
  return next;
}
const run = (record: EventRecord, filters: Partial<IdeaFilters> = {}, today = TODAY) =>
  suggestIdeas(record, today, CONFIG, { ...defaultIdeaFilters(record), ...filters });
const titles = (r: ReturnType<typeof run>) => r.shown.map((s) => s.title);
const hiddenReason = (r: ReturnType<typeof run>, title: string) =>
  r.hidden.find((h) => h.title === title)?.reasons.join(' ') ?? '';

describe('filters', () => {
  it('keeps to the event type, and can show another type with a note', () => {
    const wedding = event('wedding');
    expect(run(wedding).shown.every((s) => s.eventType === 'wedding')).toBe(true);
    const other = run(wedding, { eventType: 'community' });
    expect(other.shown[0]?.reasons.join(' ')).toMatch(
      /Written for a community; your event is a wedding/,
    );
  });

  it('respects lead time, and treats a past event honestly', () => {
    const soon = run(event('wedding', {}, { date: addDays(TODAY, 12) }));
    expect(hiddenReason(soon, 'A live food counter')).toMatch(
      /Needs about 30 days of preparation; only 12 days are left/,
    );
    expect(titles(soon)).toContain('Large, clear signs');
    expect(
      titles(run(event('wedding', {}, { date: addDays(TODAY, 12) }), { fitTime: false })),
    ).toContain('A live food counter');
    const past = run(event('birthday', {}, { date: addDays(TODAY, -3) }));
    expect(past.shown).toEqual([]);
    expect(past.hidden[0]?.reasons).toContain('The event has passed.');
  });

  it('filters by budget level', () => {
    const low = run(event('wedding'), { budget: 'low' });
    expect(titles(low)).not.toContain('A live food counter');
    expect(hiddenReason(low, 'A live food counter')).toMatch(
      /cost level is medium, above the low level/,
    );
  });

  it('matches the setting, with mixed allowing both', () => {
    const indoor = run(
      event('community', { accessibilityNeeds: [] }, { setting: 'indoor' }),
    );
    expect(hiddenReason(indoor, 'A short clean-up walk')).toMatch(
      /Works outdoor only; your event is indoor/,
    );
    expect(
      titles(run(event('community', { accessibilityNeeds: [] }, { setting: 'mixed' }))),
    ).toContain('A short clean-up walk');
    expect(
      titles(
        run(event('community', { accessibilityNeeds: [] }, { setting: 'indoor' }), {
          setting: 'any',
        }),
      ),
    ).toContain('A short clean-up walk');
  });

  it('uses the age band when one is set', () => {
    const child = run(event('birthday', {}, { ageBand: 'under-13' }));
    expect(titles(child)).toContain('A treasure hunt');
    expect(hiddenReason(child, 'A seated lounge area')).toMatch(
      /aged 50 64, 65 plus, not under 13/,
    );
    const older = run(event('birthday', {}, { ageBand: '65-plus' }));
    expect(titles(older)).toContain('A seated lounge area');
    expect(hiddenReason(older, 'A treasure hunt')).toMatch(/not 65 plus/);
  });

  it('shows food ideas only when they suit every stated dietary need', () => {
    const jain = run(event('birthday', { dietaryNeeds: ['jain'] }));
    expect(hiddenReason(jain, 'A chaat and mocktail spread')).toMatch(
      /Not shown to suit jain/,
    );
    const community = run(event('community', { dietaryNeeds: ['jain', 'vegan'] }));
    const millet = community.shown.find(
      (s) => s.title === 'Millet snacks and roasted chana',
    );
    expect(millet?.reasons.join(' ')).toMatch(/Can suit jain, vegan/);
    const unfiltered = run(event('birthday', { dietaryNeeds: ['jain'] }), {
      diet: false,
    });
    expect(
      unfiltered.shown
        .find((s) => s.title === 'A chaat and mocktail spread')
        ?.reasons.join(' '),
    ).toMatch(/Check it for jain/);
  });

  it('uses stated accessibility needs both ways', () => {
    const quiet = run(
      event('birthday', { accessibilityNeeds: ['quiet-space'] }, { ageBand: '18-29' }),
    );
    expect(hiddenReason(quiet, 'A dance-off')).toMatch(/A poor fit for quiet space/);
    const community = run(event('community'));
    expect(hiddenReason(community, 'A short clean-up walk')).toMatch(
      /poor fit for wheelchair access/,
    );
    const signs = run(event('wedding', { accessibilityNeeds: ['large-print'] }));
    expect(
      signs.shown.find((s) => s.title === 'Large, clear signs')?.reasons.join(' '),
    ).toMatch(/Helps with large print/);
  });

  it('filters and ranks by the organizer’s chosen preferences', () => {
    const picked = run(event('wedding', { priorities: [] }), {
      preferences: ['entertainment'],
    });
    expect(titles(picked)).toEqual(['Song requests from guests']);
    const ranked = run(event('wedding', { priorities: ['accessibility'] }));
    expect(ranked.shown[0]?.reasons.join(' ')).toMatch(
      /Serves your accessibility preference/,
    );
  });
});

describe('costs are illustrative and grounded, never added', () => {
  it('shows a cost only when a configured expense rate backs it', () => {
    const record = event('wedding');
    const result = run(record, { fitTime: false });
    const counter = result.shown.find((s) => s.title === 'A live food counter');
    expect(counter?.cost?.text).toMatch(
      /illustrative “Catering” estimate of ₹90,000 \(₹450 per guest × 200\)\. Nothing is added to your budget/,
    );
    const notes = result.shown.find((s) => s.title === 'Handwritten welcome notes');
    expect(notes?.cost).toBeNull();
  });

  it('saving an idea or adding its task leaves the budget unchanged', () => {
    const base = event('wedding');
    const record = apply(base, startingBudgetOperations(base, CONFIG, TODAY));
    const before = buildLedger(record, CONFIG);
    const suggestion = run(record, { fitTime: false }).shown.find(
      (s) => s.title === 'A live food counter',
    );
    if (!suggestion) throw new Error('fixture');
    const idea = ideaFromSuggestion(record, suggestion, true);
    const result = ideaTaskOperations(
      record,
      idea,
      taskPlanFor(idea, CONFIG, 'wedding'),
      TODAY,
    );
    if (!result.ok) throw new Error(result.reason);
    const next = apply(record, result.operations);
    expect(next.expenses).toEqual(record.expenses);
    expect(buildLedger(next, CONFIG).forecastPaise).toBe(before.forecastPaise);
  });
});

describe('saving, sources and the one linked task (completion check)', () => {
  it('labels the three sources', () => {
    expect(SOURCE_LABELS[sourceOf({ source: 'built-in' })]).toBe('Guided suggestion');
    expect(SOURCE_LABELS[sourceOf({ source: 'assistant' })]).toBe('Local AI draft');
    expect(SOURCE_LABELS[sourceOf({ source: 'user' })]).toBe('User idea');
  });

  it('saving a suggestion twice keeps one record', () => {
    const record = event('wedding');
    const s = run(record).shown[0];
    if (!s) throw new Error('fixture');
    const once = apply(record, [
      { op: 'ideas/upsert', item: ideaFromSuggestion(record, s, false) },
    ]);
    const again = run(once).shown.find((x) => x.templateId === s.templateId);
    if (!again) throw new Error('fixture');
    expect(again.saved?.id).toBe(once.ideas[0]?.id);
    const twice = apply(once, [
      { op: 'ideas/upsert', item: ideaFromSuggestion(once, again, true) },
    ]);
    expect(twice.ideas).toHaveLength(1);
    expect(twice.ideas[0]).toMatchObject({
      favorite: true,
      status: 'saved',
      source: 'built-in',
    });
  });

  it('adding the same idea as a task again finds the existing task', () => {
    const record = event('wedding');
    const s = run(record).shown.find((x) => x.title === 'Large, clear signs');
    if (!s) throw new Error('fixture');
    const idea = ideaFromSuggestion(record, s, false);
    const plan = taskPlanFor(idea, CONFIG, 'wedding');
    const first = ideaTaskOperations(record, idea, plan, TODAY);
    if (!first.ok) throw new Error(first.reason);
    expect(first.created).toBe(true);
    const once = apply(record, first.operations);
    expect(once.tasks).toHaveLength(1);
    expect(once.tasks[0]).toMatchObject({
      id: ideaTaskId(idea.id),
      title: 'Design and print the venue signs',
      dueDate: addDays(record.profile.date, -7),
      kind: 'preparation',
    });
    expect(once.ideas[0]?.taskId).toBe(ideaTaskId(idea.id));

    const savedIdea = once.ideas[0];
    if (!savedIdea) throw new Error('fixture');
    const second = ideaTaskOperations(once, savedIdea, plan, TODAY);
    expect(second).toMatchObject({ ok: true, created: false, operations: [] });
    // Even if the link on the idea was lost, the task id finds it again.
    const unlinked = { ...savedIdea, taskId: undefined };
    const third = ideaTaskOperations(once, unlinked, plan, TODAY);
    if (!third.ok) throw new Error(third.reason);
    const after = apply(once, third.operations);
    expect(after.tasks).toHaveLength(1);
  });

  it('dates a late idea task today and refuses one for a past event', () => {
    const record = event('wedding', {}, { date: addDays(TODAY, 3) });
    const s = run(record, { fitTime: false }).shown.find(
      (x) => x.title === 'A live food counter',
    );
    if (!s) throw new Error('fixture');
    const idea = ideaFromSuggestion(record, s, false);
    const result = ideaTaskOperations(
      record,
      idea,
      taskPlanFor(idea, CONFIG, 'wedding'),
      TODAY,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.task.dueDate).toBe(TODAY);
    expect(result.task.rationale).toMatch(/that date has passed, so it is due today/);
    const past = event('wedding', {}, { date: addDays(TODAY, -1) });
    expect(ideaTaskOperations(past, idea, { title: 'x', leadDays: 1 }, TODAY).ok).toBe(
      false,
    );
  });

  it('saves a Local AI draft once, marked as a draft', () => {
    const record = event('birthday');
    const idea = ideaFromDraft(
      { title: '  Lantern garden ', details: 'Paper lanterns along the path.' },
      'idea-1',
      TODAY,
    );
    expect(idea).toMatchObject({
      title: 'Lantern garden',
      source: 'assistant',
      status: 'saved',
    });
    expect(idea.reason).toMatch(/Drafted by Local AI .* unchecked draft/);
    const saved = apply(record, [{ op: 'ideas/upsert', item: idea }]);
    expect(draftAlreadySaved(saved, 'lantern GARDEN')?.id).toBe('idea-1');
    expect(taskPlanFor(idea, CONFIG, 'birthday')).toEqual({
      title: 'Prepare: Lantern garden',
      leadDays: 14,
    });
  });
});
