import { describe, expect, it } from 'vitest';
import { plannerReducer } from '@/app/state/plannerReducer.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { buildLedger, startingBudgetOperations } from '@/domain/planning/budget.ts';
import { startingTimelineOperations } from '@/domain/planning/timeline.ts';
import type { EventRecord, SavedAppState } from '@/domain/types.ts';
import { TODAY, presetEvent } from '@/test/helpers.ts';
import type { AssistantResponse } from './assistant.ts';
import { buildContextSnapshot } from './context.ts';
import { guidedAnswer, guidedPlannerProvider } from './guidedProvider.ts';
import {
  checkBeforeApply,
  forbiddenOperations,
  proposalFromIntent,
} from './proposals.ts';

const CONFIG = PLANNING_CONFIGURATION;

function planned(id: 'wedding' | 'birthday' | 'community' = 'wedding'): EventRecord {
  const record = presetEvent(id);
  const budget = applyOperations(record, startingBudgetOperations(record, CONFIG, TODAY));
  if (!budget) throw new Error('fixture');
  const both = applyOperations(budget, startingTimelineOperations(budget, CONFIG, TODAY));
  if (!both) throw new Error('fixture');
  return both;
}
const stateOf = (...records: EventRecord[]): SavedAppState => ({
  activeEventId: records[0]?.profile.id ?? null,
  events: records,
});
const ask = (message: string, record: EventRecord = planned()) =>
  guidedAnswer(message, buildContextSnapshot(record, TODAY, CONFIG));

function proposalOf(answer: ReturnType<typeof guidedAnswer>) {
  if (answer.kind !== 'proposal')
    throw new Error(`expected a proposal, got ${answer.kind}`);
  return answer;
}

describe('supported commands use the current event', () => {
  it('“What should I do next?” lists the most pressing real tasks', () => {
    const record = planned();
    const answer = ask('What should I do next?', record);
    expect(answer.kind).toBe('info');
    if (answer.kind !== 'info') return;
    const text = answer.paragraphs.join(' ');
    expect(text).toMatch(/18 tasks are open/);
    expect(text).toMatch(/Confirm the total budget and reserve: due/);
    expect(answer.links).toEqual([{ label: 'Open the Timeline', to: '/timeline' }]);
  });

  it('“Explain my budget.” shows the ledger’s real figures', () => {
    const record = planned();
    const ledger = buildLedger(record, CONFIG);
    const answer = ask('Explain my budget.', record);
    if (answer.kind !== 'info') throw new Error('expected info');
    expect(answer.facts).toContainEqual({ label: 'Forecast', value: '₹4,39,000' });
    expect(ledger.forecastPaise).toBe(43_900_000);
    expect(answer.paragraphs[0]).toBe(
      'Headroom = budget ₹5,00,000 − reserve ₹50,000 − forecast ₹4,39,000 = ₹11,000.',
    );
  });

  it('“Reduce my budget by 15%.” proposes a change with an engine preview, and changes nothing', () => {
    const record = planned();
    const state = stateOf(record);
    const copy = structuredClone(state);
    const answer = proposalOf(ask('Reduce my budget by 15%.', record));
    expect(answer.intent).toEqual({ type: 'reduce-budget-percent', percent: 15 });
    const built = proposalFromIntent(
      state,
      record.profile.id,
      answer.intent,
      CONFIG,
      TODAY,
      'p1',
    );
    if (!built.ok) throw new Error(built.reason);
    expect(built.preview.status).toBe('ok');
    expect(built.preview.money).toMatchObject({
      budgetBefore: 50_000_000,
      budgetAfter: 42_500_000,
    });
    expect(built.change).toMatchObject({
      baseRevision: record.profile.revision,
      source: 'assistant',
    });
    expect(state).toEqual(copy);
  });

  it('“Set guests to 120.” moves only per-guest costs, by the engine’s numbers', () => {
    const record = planned();
    const ledger = buildLedger(record, CONFIG);
    const answer = proposalOf(ask('Set guests to 120.', record));
    const built = proposalFromIntent(
      stateOf(record),
      record.profile.id,
      answer.intent,
      CONFIG,
      TODAY,
      'p1',
    );
    if (!built.ok) throw new Error(built.reason);
    expect(built.preview.money.forecastAfter - built.preview.money.forecastBefore).toBe(
      ledger.perGuestPaise * (120 - 200),
    );
    expect(built.preview.fieldChanges).toContainEqual({
      field: 'guestCount',
      label: 'Guests',
      before: '200',
      after: '120',
    });
  });

  it('“What changes if we move outdoors?” previews the new backup steps and costs', () => {
    const record = planned();
    const answer = proposalOf(ask('What changes if we move outdoors?', record));
    expect(answer.intent).toEqual({ type: 'set-setting', setting: 'outdoor' });
    const built = proposalFromIntent(
      stateOf(record),
      record.profile.id,
      answer.intent,
      CONFIG,
      TODAY,
      'p1',
    );
    if (!built.ok) throw new Error(built.reason);
    expect(built.preview.tasks.added.map((t) => t.title)).toContain(
      'Decide on the backup if outdoor spaces cannot be used',
    );
    expect(built.preview.expenses.added.map((e) => e.name)).toContain(
      'Covered area or tent for backup',
    );
  });

  it('“Suggest vegetarian birthday ideas.” drafts ideas that suit the request', () => {
    const answer = ask('Suggest vegetarian birthday ideas.', planned('birthday'));
    if (answer.kind !== 'draft') throw new Error('expected a draft');
    expect(answer.items.length).toBeGreaterThan(2);
    expect(answer.title).toBe('Vegetarian birthday ideas');
    expect(answer.note).toMatch(/not saved anywhere/);
  });

  it('a change on an event without a plan never quietly creates one', () => {
    const bare = presetEvent('wedding');
    const answer = proposalOf(ask('Set guests to 150', bare));
    const built = proposalFromIntent(
      stateOf(bare),
      bare.profile.id,
      answer.intent,
      CONFIG,
      TODAY,
      'p1',
    );
    if (!built.ok) throw new Error(built.reason);
    expect(built.change.operations).toEqual([
      { op: 'profile/patch', patch: { guestCount: 150 } },
    ]);
  });
});

describe('clarification instead of guessing', () => {
  it('asks whether a bare number is a percentage or rupees', () => {
    const answer = ask('Reduce my budget by 15');
    expect(answer).toMatchObject({
      kind: 'question',
      options: [
        { label: '15%', message: 'Reduce my budget by 15%' },
        { label: '₹15', message: 'Reduce my budget by ₹15' },
      ],
    });
  });

  it('accepts explicit units: rupees and lakh', () => {
    expect(proposalOf(ask('Reduce my budget by ₹20,000')).intent).toEqual({
      type: 'set-budget',
      budgetPaise: 50_000_000 - 2_000_000,
    });
    expect(proposalOf(ask('Set the budget to 4.5 lakh')).intent).toEqual({
      type: 'set-budget',
      budgetPaise: 45_000_000,
    });
    expect(ask('Set the budget to 450000').kind).toBe('question');
  });

  it('asks for one exact guest count, and one change at a time', () => {
    expect(ask('Set guests to about 120').kind).toBe('question');
    expect(ask('Set guests to 120 or 130').kind).toBe('question');
    expect(ask('Set guests to 12.5').kind).toBe('question');
    expect(ask('Set guests to 0').kind).toBe('question');
    const both = ask('Set guests to 120 and reduce my budget by 15%');
    expect(both.kind).toBe('question');
    if (both.kind === 'question') {
      expect(both.options.map((o) => o.message)).toEqual([
        'Set guests to 120',
        'Reduce the budget by 15%',
      ]);
    }
  });

  it('asks when the requested event type does not match this event', () => {
    const answer = ask('Suggest vegetarian birthday ideas', planned('wedding'));
    expect(answer).toMatchObject({
      kind: 'question',
      options: [{ message: 'suggest vegetarian wedding ideas' }],
    });
  });

  it('asks for a percentage reserve, and refuses out-of-range values', () => {
    expect(proposalOf(ask('Set the reserve to 12.5%')).intent).toEqual({
      type: 'set-reserve',
      reserveBasisPoints: 1250,
    });
    expect(ask('Set the reserve to 12').kind).toBe('question');
    expect(ask('Set the reserve to 80%').kind).toBe('question');
    expect(ask('Reduce my budget by 150%').kind).toBe('question');
  });
});

describe('unsupported requests point to the right form', () => {
  it.each([
    ['Record a payment of ₹5,000 to the caterer', '/budget'],
    ['Delete this event', '/'],
    ['Mark the caterer as booked', '/vendors'],
    ['Add a task to buy candles', '/timeline'],
    ['Move the date to 1 December', '/'],
    ['<script>alert(1)</script>', '/'],
  ])('%s', (message, to) => {
    const answer = ask(message);
    expect(answer.kind).toBe('info');
    if (answer.kind === 'info') expect(answer.links?.[0]?.to).toBe(to);
  });

  it('says plainly what it is when it does not recognise a request', () => {
    const answer = ask('Write me a poem about my cousin');
    if (answer.kind !== 'info') throw new Error('expected info');
    expect(answer.paragraphs[0]).toMatch(/fixed set of commands, not free conversation/);
    expect(answer.suggestions?.length).toBeGreaterThan(4);
  });
});

describe('proposals cannot reach a different or newer event state (completion check)', () => {
  it('is refused for another event and after any other edit', () => {
    const a = planned('wedding');
    const b = {
      ...presetEvent('birthday'),
      profile: { ...presetEvent('birthday').profile, id: 'event-b' },
    };
    const state = stateOf(a, b);
    const built = proposalFromIntent(
      state,
      a.profile.id,
      { type: 'set-guest-count', guestCount: 120 },
      CONFIG,
      TODAY,
      'p1',
    );
    if (!built.ok) throw new Error(built.reason);

    expect(checkBeforeApply(state, built.change, 'event-b', TODAY)).toEqual({
      ok: false,
      reason: 'This proposal belongs to a different event.',
    });
    expect(checkBeforeApply(state, built.change, a.profile.id, TODAY).ok).toBe(true);

    const edited = plannerReducer(state, {
      type: 'event/edit',
      eventId: a.profile.id,
      operations: [{ op: 'profile/patch', patch: { city: 'Mumbai' } }],
    });
    const stale = checkBeforeApply(edited, built.change, a.profile.id, TODAY);
    expect(stale.ok).toBe(false);
    if (!stale.ok)
      expect(stale.reason).toMatch(/event has changed since this proposal was made/);
    // The reducer refuses it too.
    const after = plannerReducer(edited, {
      type: 'event/edit',
      eventId: a.profile.id,
      operations: built.change.operations,
      expectedRevision: built.change.baseRevision,
    });
    expect(after).toBe(edited);
  });

  it('refuses operations an assistant may never perform', () => {
    const record = planned();
    const [expense] = record.expenses;
    if (!expense) throw new Error('fixture');
    expect(
      forbiddenOperations(record, [
        {
          op: 'expenses/upsert',
          item: { ...expense, payments: [{ id: 'p', amountPaise: 1, date: TODAY }] },
        },
        {
          op: 'vendors/upsert',
          item: { id: 'v', name: 'V', kind: 'venue', status: 'booked', quotePaise: null },
        },
      ]),
    ).toEqual([
      'An assistant cannot change payments or agreed amounts.',
      'An assistant cannot change vendors or mark one booked.',
    ]);
    expect(
      proposalFromIntent(
        stateOf(record),
        record.profile.id,
        { type: 'mark-booked' },
        CONFIG,
        TODAY,
        'p',
      ).ok,
    ).toBe(false);
  });
});

describe('malformed proposals from a provider are refused, never repaired', () => {
  const record = planned();
  const build = (intent: unknown) =>
    proposalFromIntent(stateOf(record), record.profile.id, intent, CONFIG, TODAY, 'p');

  it.each([
    ['nothing at all', undefined],
    ['a string instead of an object', 'set-budget 500000'],
    ['an unknown change type', { type: 'delete-event' }],
    ['a missing value', { type: 'set-budget' }],
    ['money as text', { type: 'set-budget', budgetPaise: '₹5,00,000' }],
    ['fractional paise', { type: 'set-budget', budgetPaise: 12.5 }],
    ['a negative amount', { type: 'set-budget', budgetPaise: -100 }],
    ['zero guests', { type: 'set-guest-count', guestCount: 0 }],
    ['a fractional guest count', { type: 'set-guest-count', guestCount: 120.5 }],
    ['a percentage over 99', { type: 'reduce-budget-percent', percent: 150 }],
    ['an unknown setting', { type: 'set-setting', setting: 'underwater' }],
    [
      'a reserve over the maximum',
      { type: 'set-reserve', reserveBasisPoints: 1_000_000 },
    ],
  ])('refuses %s', (_label, intent) => {
    expect(build(intent)).toEqual({ ok: false, reason: 'That change is not supported.' });
  });

  it('ignores extra fields instead of carrying them into the change', () => {
    const result = build({
      type: 'set-guest-count',
      guestCount: 150,
      operations: [{ op: 'events/delete' }],
      eventId: 'someone-else',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.change.eventId).toBe(record.profile.id);
    expect(result.change.operations.map((o) => o.op)).not.toContain('events/delete');
    expect(result.change.operations[0]).toEqual({
      op: 'profile/patch',
      patch: { guestCount: 150 },
    });
  });

  it('refuses a well-formed change for an event that does not exist', () => {
    expect(
      proposalFromIntent(
        stateOf(record),
        'missing-event',
        { type: 'set-guest-count', guestCount: 150 },
        CONFIG,
        TODAY,
        'p',
      ),
    ).toEqual({ ok: false, reason: 'That event no longer exists.' });
  });
});

describe('provider contract', () => {
  it('echoes the request ids and labels its output', async () => {
    const record = planned();
    const response: AssistantResponse = await guidedPlannerProvider.respond({
      requestId: 'r1',
      eventId: record.profile.id,
      revision: record.profile.revision,
      context: buildContextSnapshot(record, TODAY, CONFIG),
      message: 'help',
    });
    expect(response).toMatchObject({
      requestId: 'r1',
      eventId: record.profile.id,
      revision: record.profile.revision,
      provider: { id: 'guided', label: 'Guided planner' },
    });
  });

  it('rejects a cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const record = planned();
    await expect(
      guidedPlannerProvider.respond(
        {
          requestId: 'r1',
          eventId: record.profile.id,
          revision: 0,
          context: buildContextSnapshot(record, TODAY, CONFIG),
          message: 'help',
        },
        controller.signal,
      ),
    ).rejects.toThrow('Cancelled');
  });

  it('builds a bounded snapshot without guest names, notes or contact details', () => {
    const record = applyOperations(planned(), [
      {
        op: 'guests/upsert',
        item: {
          id: 'g',
          name: 'Secret Name',
          partySize: 2,
          rsvp: 'accepted',
          dietaryNeeds: [],
          accessibilityNeeds: [],
          notes: 'private note',
        },
      },
      {
        op: 'vendors/upsert',
        item: {
          id: 'v',
          name: 'Hall',
          kind: 'venue',
          status: 'booked',
          quotePaise: null,
          contact: '98xxxx',
        },
      },
    ]);
    if (!record) throw new Error('fixture');
    const snapshot = buildContextSnapshot(record, TODAY, CONFIG);
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/Secret Name|private note|98xxxx/);
    expect(snapshot.timeline.next.length).toBeLessThanOrEqual(5);
    expect(snapshot.budget.categories.length).toBeLessThanOrEqual(5);
    expect(snapshot.concerns.length).toBeLessThanOrEqual(5);
    expect(snapshot.guests).toEqual({ listedPeople: 2, acceptedPeople: 2 });
    expect(snapshot.vendors).toEqual({ listed: 1, booked: 1 });
  });
});

describe('template-based invitation wording', () => {
  it('fills a fixed template with the event’s details and leaves unknowns blank', () => {
    const record = planned('birthday');
    const answer = ask('Write invitation wording.', record);
    expect(answer).toMatchObject({
      kind: 'draft',
      title: 'Invitation wording (template)',
    });
    if (answer.kind !== 'draft') return;
    expect(answer.intro).toContain(
      'You are invited to join us for “Demo birthday party (fictional)”.',
    );
    expect(answer.intro).toMatch(/Date: \d{1,2} \w+ \d{4}/);
    expect(answer.intro).toContain('[RSVP contact]');
    expect(answer.intro).toContain(`, ${record.profile.city}`);
    expect(answer.note).toMatch(/fixed template/);
  });
});
