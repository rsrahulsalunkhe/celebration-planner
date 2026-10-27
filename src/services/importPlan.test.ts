import { afterEach, describe, expect, it, vi } from 'vitest';
import { plannerReducer } from '@/app/state/plannerReducer.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { copyWithNewIds } from '@/domain/importCopy.ts';
import { startingBudgetOperations } from '@/domain/planning/budget.ts';
import {
  defaultIdeaFilters,
  ideaFromSuggestion,
  ideaTaskOperations,
  suggestIdeas,
  taskPlanFor,
} from '@/domain/planning/ideas.ts';
import { startingTimelineOperations } from '@/domain/planning/timeline.ts';
import { agreedQuoteOperations, shortlistSample } from '@/domain/planning/vendors.ts';
import { SAMPLE_VENDORS } from '@/data/sampleVendors.ts';
import type { ChangeOperation, EventRecord, SavedAppState } from '@/domain/types.ts';
import { TODAY, presetEvent } from '@/test/helpers.ts';
import {
  EVENT_EXPORT_FORMAT,
  buildEventExport,
  buildJsonExport,
  downloadFile,
} from './export.ts';
import { MAX_IMPORT_BYTES, checkImportSize, parseImportText } from './importPlan.ts';

const CONFIG = PLANNING_CONFIGURATION;

function apply(record: EventRecord, ops: readonly ChangeOperation[]): EventRecord {
  const next = applyOperations(record, ops);
  if (!next) throw new Error('operations did not apply');
  return next;
}

/** A wedding with something in every collection: budget, payment, vendor, tasks, ideas, guests, running order. */
function fullEvent(): EventRecord {
  let r = presetEvent('wedding');
  r = apply(r, startingBudgetOperations(r, CONFIG, TODAY));
  r = apply(r, startingTimelineOperations(r, CONFIG, TODAY));
  const lotus = SAMPLE_VENDORS.find((s) => s.id === 'sample.lotus-courtyard-hall');
  if (!lotus) throw new Error('fixture');
  const vendor = shortlistSample(lotus, 'vendor-1');
  r = apply(r, [{ op: 'vendors/upsert', item: vendor }]);
  const venue = r.expenses.find((e) => e.templateId === 'expense.venue-hire');
  if (!venue) throw new Error('fixture');
  const quote = agreedQuoteOperations(r, vendor, {
    basis: 'fixed',
    amountPaise: 11_000_000,
    depositPaise: 2_000_000,
    depositPaidOn: TODAY,
    expenseId: venue.id,
    categoryId: venue.categoryId,
    newExpenseId: 'unused',
  });
  if (!quote.ok) throw new Error(quote.issues.join());
  r = apply(r, quote.operations);
  const suggestion = suggestIdeas(r, TODAY, CONFIG, defaultIdeaFilters(r)).shown[0];
  if (!suggestion) throw new Error('fixture');
  const idea = ideaFromSuggestion(r, suggestion, true);
  const ideaTask = ideaTaskOperations(
    r,
    idea,
    taskPlanFor(idea, CONFIG, 'wedding'),
    TODAY,
  );
  if (!ideaTask.ok) throw new Error(ideaTask.reason);
  r = apply(r, ideaTask.operations);
  return apply(r, [
    {
      op: 'guests/upsert',
      item: {
        id: 'g1',
        name: 'Rao family',
        partySize: 4,
        rsvp: 'accepted',
        dietaryNeeds: [],
        accessibilityNeeds: [],
      },
    },
    {
      op: 'runOrder/upsert',
      item: { id: 'r1', title: 'Welcome', start: '18:00', end: '18:30' },
    },
  ]);
}

const exportOf = (
  record: EventRecord,
  extra: Partial<Parameters<typeof buildEventExport>[1]> = {},
) =>
  buildEventExport(record, {
    exportedAt: '2026-10-26T10:00:00.000Z',
    includeGuests: true,
    ...extra,
  });

describe('export and import round trip (completion check)', () => {
  it('a plan file reads back to exactly the same event', () => {
    const record = fullEvent();
    const file = exportOf(record);
    expect(file.filename).toBe('demo-wedding-fictional-plan.json');
    const json = JSON.parse(file.content) as Record<string, unknown>;
    expect(json).toMatchObject({
      format: EVENT_EXPORT_FORMAT,
      version: 1,
      exportedAt: '2026-10-26T10:00:00.000Z',
    });
    const result = parseImportText(file.content);
    if (!result.ok) throw new Error(result.details.join());
    expect(result.kind).toBe('event');
    expect(result.events).toEqual([record]);
  });

  it('a copy gets new ids everywhere, with every link kept', () => {
    const record = fullEvent();
    let n = 0;
    const copy = copyWithNewIds(
      record,
      'event-copy',
      (prefix) => `${prefix}-n${(n += 1)}`,
    );
    if (!copy) throw new Error('copy failed');
    expect(copy.profile).toMatchObject({
      id: 'event-copy',
      revision: 0,
      title: record.profile.title,
    });
    const oldIds = new Set(
      [
        record.profile.id,
        ...record.budgetCategories,
        ...record.expenses,
        ...record.tasks,
        ...record.vendors,
        ...record.ideas,
        ...record.guests,
        ...record.runOrder,
      ].map((x) => (typeof x === 'string' ? x : x.id)),
    );
    const newIds = [
      copy.profile.id,
      ...copy.budgetCategories,
      ...copy.expenses,
      ...copy.tasks,
      ...copy.vendors,
      ...copy.ideas,
      ...copy.guests,
      ...copy.runOrder,
    ].map((x) => (typeof x === 'string' ? x : x.id));
    expect(newIds.filter((id) => oldIds.has(id))).toEqual([]);
    const linkedExpense = copy.expenses.find((e) => e.vendorId !== undefined);
    expect(linkedExpense?.vendorId).toBe(copy.vendors[0]?.id);
    expect(linkedExpense?.payments[0]?.id).toBe(`${copy.vendors[0]?.id ?? ''}~deposit`);
    const idea = copy.ideas[0];
    expect(copy.tasks.some((t) => t.id === idea?.taskId)).toBe(true);
    expect(idea?.taskId).toBe(`${idea?.id ?? ''}~task`);
    // Same content apart from ids.
    expect(copy.expenses.map((e) => e.commitment)).toEqual(
      record.expenses.map((e) => e.commitment),
    );
    expect(copy.tasks.map((t) => [t.title, t.dueDate, t.status])).toEqual(
      record.tasks.map((t) => [t.title, t.dueDate, t.status]),
    );
  });

  it('reads a full backup too, and leaves guests out when asked', () => {
    const record = fullEvent();
    const backup = parseImportText(
      buildJsonExport({ activeEventId: record.profile.id, events: [record] }).content,
    );
    expect(backup).toMatchObject({ ok: true, kind: 'backup' });
    const noGuests = parseImportText(exportOf(record, { includeGuests: false }).content);
    if (!noGuests.ok) throw new Error('parse');
    expect(noGuests.events[0]?.guests).toEqual([]);
  });

  it('never imports the conversation, and says so', () => {
    const file = exportOf(fullEvent(), {
      conversation: [{ role: 'user', text: 'Explain my budget' }],
    });
    expect(JSON.parse(file.content)).toHaveProperty('conversation');
    const result = parseImportText(file.content);
    if (!result.ok) throw new Error('parse');
    expect(result.notImported[0]).toMatch(/conversation .* is not imported/);
    expect(JSON.stringify(result.events)).not.toContain('Explain my budget');
  });
});

describe('copies in edge cases', () => {
  it('gives ordinary payments new ids and keeps the vendor deposit link', () => {
    const record = fullEvent();
    const linked = record.expenses.find((e) => e.vendorId !== undefined);
    if (!linked) throw new Error('fixture');
    const withExtra = apply(record, [
      {
        op: 'expenses/upsert',
        item: {
          ...linked,
          payments: [
            ...linked.payments,
            { id: 'p-extra', amountPaise: 100_000, date: TODAY },
          ],
        },
      },
    ]);
    let n = 0;
    const copy = copyWithNewIds(
      withExtra,
      'event-copy',
      (prefix) => `${prefix}-c${(n += 1)}`,
    );
    const copied = copy?.expenses.find((e) => e.vendorId !== undefined);
    expect(copied?.payments.map((p) => p.id)).toEqual([
      `${copied?.vendorId ?? ''}~deposit`,
      expect.stringMatching(/^payment-c\d+$/),
    ]);
    expect(copied?.payments.map((p) => p.amountPaise)).toEqual(
      withExtra.expenses
        .find((e) => e.id === linked.id)
        ?.payments.map((p) => p.amountPaise),
    );
  });

  it('copies an event with nothing planned yet', () => {
    const bare = presetEvent('birthday');
    const copy = copyWithNewIds(bare, 'event-bare', (prefix) => `${prefix}-1`);
    expect(copy?.profile).toMatchObject({ id: 'event-bare', revision: 0 });
    expect(copy?.tasks).toEqual([]);
  });

  it('returns nothing, rather than a broken copy, when the new ids are not valid', () => {
    expect(copyWithNewIds(fullEvent(), 'event copy with spaces', (p) => p)).toBeNull();
  });
});

describe('invalid files are refused without changing anything (completion check)', () => {
  const good = () =>
    JSON.parse(exportOf(fullEvent()).content) as Record<string, unknown> & {
      event: EventRecord;
    };
  const refuse = (value: unknown) =>
    parseImportText(typeof value === 'string' ? value : JSON.stringify(value));

  it.each([
    ['not JSON', '{ this is not json', /not valid JSON/],
    ['an array', '[1,2,3]', /not a Celebration Planner file/],
    [
      'another format',
      { format: 'something-else', version: 1 },
      /not a Celebration Planner plan file/,
    ],
    [
      'a newer version',
      { format: EVENT_EXPORT_FORMAT, version: 2, event: {} },
      /version is not supported/,
    ],
    [
      'a newer backup',
      { schemaVersion: 9, data: {} },
      /backup’s version is not supported/,
    ],
  ])('refuses %s', (_label, value, title) => {
    const result = refuse(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.title).toMatch(title);
  });

  it('refuses malformed money and dates, naming where', () => {
    const money = good();
    const firstExpense = money.event.expenses.find((e) => e.estimate.basis === 'fixed');
    if (!firstExpense) throw new Error('fixture');
    (firstExpense.estimate as { amountPaise: unknown }).amountPaise = 12.5;
    const moneyResult = refuse(money);
    expect(moneyResult.ok).toBe(false);
    if (!moneyResult.ok)
      expect(moneyResult.details.join(' ')).toMatch(
        /expenses › 0 › estimate › amountPaise: Amount must be a whole number/,
      );

    const date = good();
    date.event.profile.date = '2027-02-30';
    const dateResult = refuse(date);
    if (dateResult.ok) throw new Error('expected failure');
    expect(dateResult.details.join(' ')).toMatch(/profile › date/);

    const text = good();
    (text.event.profile as { budgetPaise: unknown }).budgetPaise = '₹5,00,000';
    expect(refuse(text).ok).toBe(false);
  });

  it('refuses collections over their limits', () => {
    const big = good();
    big.event.ideas = Array.from({ length: 101 }, (_, i) => ({
      id: `i${i}`,
      title: 'x',
      kind: 'theme',
      status: 'saved',
      source: 'user',
    }));
    const result = refuse(big);
    if (result.ok) throw new Error('expected failure');
    expect(result.details.join(' ')).toMatch(/ideas: Too big/);
  });

  it('drops unknown properties instead of merging them, including __proto__', () => {
    const value = good();
    const text = JSON.stringify(value).replace(
      '"profile":{',
      '"profile":{"__proto__":{"polluted":true},"isAdmin":true,',
    );
    const result = refuse(`${text.slice(0, -1)},"extra":{"evil":1}}`);
    if (!result.ok) throw new Error(result.details.join());
    const profile = result.events[0]?.profile as Record<string, unknown>;
    expect(profile.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(profile)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses files over 1 MB before reading them', () => {
    expect(checkImportSize(MAX_IMPORT_BYTES + 1)).toMatch(/at most 1 MB/);
    expect(checkImportSize(MAX_IMPORT_BYTES)).toBeNull();
    expect(parseImportText(' '.repeat(MAX_IMPORT_BYTES + 1)).ok).toBe(false);
  });
});

describe('import and replace in the reducer', () => {
  const state = (...events: EventRecord[]): SavedAppState => ({
    activeEventId: events[0]?.profile.id ?? null,
    events,
  });

  it('adds a copy and makes it active, but never by matching id', () => {
    const record = fullEvent();
    const s = state(record);
    expect(plannerReducer(s, { type: 'event/import', record })).toBe(s);
    const copy = copyWithNewIds(
      record,
      'event-copy',
      (p) => `${p}-${Math.random().toString(36).slice(2)}`,
    );
    if (!copy) throw new Error('copy');
    const next = plannerReducer(s, { type: 'event/import', record: copy });
    expect(next.events).toHaveLength(2);
    expect(next.activeEventId).toBe('event-copy');
  });

  it('replaces only at the expected revision, and raises the revision', () => {
    const record = fullEvent();
    const s = state(record);
    const imported = {
      ...record,
      profile: { ...record.profile, city: 'Mumbai', revision: 0 },
    };
    expect(
      plannerReducer(s, { type: 'event/replace', record: imported, expectedRevision: 0 }),
    ).toBe(s);
    const next = plannerReducer(s, {
      type: 'event/replace',
      record: imported,
      expectedRevision: record.profile.revision,
    });
    expect(next.events[0]?.profile).toMatchObject({
      city: 'Mumbai',
      revision: record.profile.revision + 1,
    });
  });
});

describe('downloads', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses a Blob URL and releases it after the click', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    expect(
      downloadFile({ filename: 'a.json', mimeType: 'application/json', content: '{}' }),
    ).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
