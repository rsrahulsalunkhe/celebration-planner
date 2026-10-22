import { describe, expect, it } from 'vitest';
import { plannerReducer } from '@/app/state/plannerReducer.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { SAMPLE_VENDORS } from '@/data/sampleVendors.ts';
import { TODAY, presetEvent } from '@/test/helpers.ts';
import { applyOperations } from '../editEvent.ts';
import { eventRecordSchema } from '../schemas.ts';
import type {
  ChangeOperation,
  EventRecord,
  GuestRecord,
  Preferences,
  Vendor,
} from '../types.ts';
import { buildLedger, startingBudgetOperations } from './budget.ts';
import { guestCountSuggestions, previewGuestCount } from './guests.ts';
import {
  agreedQuoteOperations,
  depositPaymentId,
  linkedExpense,
  matchVendors,
  shortlistSample,
  vendorCandidates,
  vendorChecklist,
  vendorRequirements,
  type VendorMatch,
} from './vendors.ts';

const CONFIG = PLANNING_CONFIGURATION;

function apply(record: EventRecord, operations: readonly ChangeOperation[]): EventRecord {
  const next = applyOperations(record, operations);
  if (!next) throw new Error('operations did not apply');
  return next;
}

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

function budgeted(record: EventRecord): EventRecord {
  return apply(record, startingBudgetOperations(record, CONFIG, TODAY));
}

function matchAll(record: EventRecord): VendorMatch[] {
  return matchVendors(
    record,
    vendorCandidates(record, SAMPLE_VENDORS),
    vendorRequirements(record),
  );
}
const find = (matches: VendorMatch[], name: string): VendorMatch => {
  const m = matches.find((x) => x.candidate.name === name);
  if (!m) throw new Error(`no match for ${name}`);
  return m;
};

describe('matching uses the event’s actual requirements', () => {
  it('accessibility needs change which venues match (completion check)', () => {
    const plain = matchAll(event('wedding', { accessibilityNeeds: [] }));
    expect(find(plain, 'Lotus Courtyard Hall').status).toBe('suitable');
    expect(find(plain, 'Riverside Lawns').status).toBe('suitable');

    const wheelchair = matchAll(
      event('wedding', { accessibilityNeeds: ['wheelchair-access'] }),
    );
    expect(find(wheelchair, 'Lotus Courtyard Hall').status).toBe('suitable');
    const riverside = find(wheelchair, 'Riverside Lawns');
    expect(riverside.status).toBe('needs-confirmation');
    const wheelchairCheck = riverside.checks.find(
      (c) => c.capability === 'wheelchair-access',
    );
    expect(wheelchairCheck?.outcome).toBe('unknown');
    expect(wheelchairCheck?.text).toMatch(
      /Wheelchair access: not known\..*Ask them to confirm/,
    );

    const stepFree = matchAll(
      event('wedding', { accessibilityNeeds: ['wheelchair-access', 'step-free-route'] }),
    );
    const excluded = find(stepFree, 'Riverside Lawns');
    expect(excluded.status).toBe('unsuitable');
    expect(excluded.rank).toBeNull();
    expect(excluded.summary).toMatch(
      /^Excluded: .*Step-free route: Sample data says they cannot provide it/,
    );
  });

  it('checks service area, event type and capacity, with plain explanations', () => {
    const birthday = matchAll(event('birthday'));
    expect(find(birthday, 'Rooftop Terrace Café').status).toBe('suitable');
    expect(find(birthday, 'Lotus Courtyard Hall').summary).toMatch(
      /Serves Pune, not Nashik/,
    );
    expect(find(birthday, 'Satara Community Kitchen').summary).toMatch(
      /Does not take birthday events/,
    );
    const bigger = matchAll(event('birthday', {}, { guestCount: 100 }));
    expect(find(bigger, 'Rooftop Terrace Café').summary).toMatch(
      /Serves up to 60 guests; you expect 100/,
    );
    const tiny = matchAll(event('wedding', {}, { guestCount: 20 }));
    expect(find(tiny, 'Riverside Lawns').summary).toMatch(
      /Takes bookings from 100 guests/,
    );
  });

  it('applies dietary needs to caterers and outdoor settings to venues and equipment', () => {
    const req = vendorRequirements(event('community', { dietaryNeeds: ['jain'] }));
    expect(req.byKind.catering.map((r) => r.capability)).toEqual(['jain']);
    expect(req.byKind.venue.map((r) => r.capability)).toEqual([
      'wheelchair-access',
      'weather-cover',
    ]);
    expect(req.byKind.other.map((r) => r.capability)).toEqual(['weather-cover']);
    expect(req.byKind.transport.map((r) => r.capability)).toEqual(['wheelchair-access']);
    expect(req.byKind.photography).toEqual([]);
  });

  it('ranks with transparent criteria: suitable first, then fewer unknowns, then within target', () => {
    const record = budgeted(
      event('wedding', { accessibilityNeeds: ['wheelchair-access'] }),
    );
    const venues = matchAll(record).filter(
      (m) => m.candidate.kind === 'venue' && m.status !== 'unsuitable',
    );
    expect(venues.map((m) => [m.candidate.name, m.rank])).toEqual([
      ['Lotus Courtyard Hall', 1],
      ['Riverside Lawns', 2],
    ]);
    expect(venues[0]?.summary).toMatch(
      /^Ranked 1 among venue options: meets 4 of 4 checks; illustrative estimate ₹1,20,000 is (within|above) the ₹[\d,.]+ target\.$/,
    );
    expect(venues[1]?.summary).toMatch(/1 still to confirm/);
  });

  it('treats the organizer’s own vendor honestly: unknowns stay unknown until recorded', () => {
    const own: Vendor = {
      id: 'v1',
      name: 'Hall my aunt suggested',
      kind: 'venue',
      status: 'contacted',
      quotePaise: null,
    };
    let record = apply(event('community'), [{ op: 'vendors/upsert', item: own }]);
    let match = find(matchAll(record), own.name);
    expect(match.candidate.source).toBe('user');
    expect(match.status).toBe('needs-confirmation');
    expect(match.checks.map((c) => c.outcome)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);

    record = apply(record, [
      {
        op: 'vendors/upsert',
        item: {
          ...own,
          serviceArea: 'Satara and nearby',
          capacityMax: 300,
          capabilities: { 'wheelchair-access': true, 'weather-cover': false },
        },
      },
    ]);
    match = find(matchAll(record), own.name);
    expect(match.status).toBe('unsuitable');
    expect(match.summary).toMatch(
      /Covered or indoor alternative: You recorded they cannot provide it/,
    );
  });

  it('lets the organizer’s confirmation override the sample data', () => {
    const base = event('wedding', { accessibilityNeeds: ['wheelchair-access'] });
    const riverside = SAMPLE_VENDORS.find((s) => s.id === 'sample.riverside-lawns');
    if (!riverside) throw new Error('fixture');
    const saved = {
      ...shortlistSample(riverside, 'v-r'),
      capabilities: { 'wheelchair-access': true },
    };
    const record = apply(base, [{ op: 'vendors/upsert', item: saved }]);
    const match = find(matchAll(record), 'Riverside Lawns');
    expect(match.candidate.vendor?.id).toBe('v-r');
    expect(match.status).toBe('suitable');
    expect(match.checks.find((c) => c.capability === 'wheelchair-access')?.text).toMatch(
      /you confirmed it/,
    );
  });
});

describe('sample data', () => {
  it('is fictional and makes no claims it cannot back', () => {
    const ids = SAMPLE_VENDORS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SAMPLE_VENDORS) {
      expect(s.id).toMatch(/^sample\.[a-z0-9-]+$/);
      const text = JSON.stringify(s);
      expect(text).not.toMatch(
        /rating|stars|@|https?:|\+91|\d{10}|available on|verified|booked/i,
      );
      expect(s.toConfirm.length).toBeGreaterThan(0);
    }
  });

  it('shortlisting copies only the name and kind, and a sample can be listed once', () => {
    const sample = SAMPLE_VENDORS[0];
    if (!sample) throw new Error('fixture');
    const vendor = shortlistSample(sample, 'v1');
    expect(vendor).toEqual({
      id: 'v1',
      name: sample.name,
      kind: sample.kind,
      status: 'shortlisted',
      quotePaise: null,
      sampleId: sample.id,
    });
    const twice = {
      ...presetEvent('wedding'),
      vendors: [vendor, { ...vendor, id: 'v2' }],
    };
    expect(eventRecordSchema.safeParse(twice).success).toBe(false);
  });
});

describe('organizer checklist', () => {
  it('always covers availability, quote scope, accessibility, payment and cancellation', () => {
    const list = vendorChecklist(
      event('wedding', { dietaryNeeds: [] }),
      'photography',
      CONFIG,
      null,
    );
    expect(list.map((q) => q.id).slice(0, 5)).toEqual([
      'core.availability',
      'core.quote-scope',
      'core.accessibility',
      'core.payment-terms',
      'core.cancellation',
    ]);
    expect(list.some((q) => q.id === 'core.dietary')).toBe(false);
  });

  it('adds dietary capability for caterers and listed needs, plus plan and sample questions', () => {
    const record = event('community', { dietaryNeeds: ['jain', 'vegan'] });
    const sample =
      SAMPLE_VENDORS.find((s) => s.id === 'sample.satara-community-kitchen') ?? null;
    const list = vendorChecklist(record, 'catering', CONFIG, sample);
    expect(list.find((q) => q.id === 'core.dietary')?.text).toMatch(
      /jain menu, vegan menu/i,
    );
    expect(list.find((q) => q.id === 'core.accessibility')?.text).toMatch(
      /wheelchair access/,
    );
    expect(list.some((q) => q.id.startsWith('checklist.food.'))).toBe(true);
    expect(list.at(-1)?.text).toMatch(/volunteers are expected to help serve/);
  });
});

describe('an agreed quote links to exactly one expense', () => {
  function setUp() {
    const lotus = SAMPLE_VENDORS.find((s) => s.id === 'sample.lotus-courtyard-hall');
    if (!lotus) throw new Error('fixture');
    const vendor = shortlistSample(lotus, 'vendor-lotus');
    const record = apply(budgeted(event('wedding')), [
      { op: 'vendors/upsert', item: vendor },
    ]);
    const venueHire = record.expenses.find((e) => e.templateId === 'expense.venue-hire');
    if (!venueHire) throw new Error('no venue hire expense');
    return { record, vendor, venueHire };
  }
  const quote = (expenseId: string, extra = {}) => ({
    basis: 'fixed' as const,
    amountPaise: 11_000_000,
    depositPaise: 3_000_000,
    depositPaidOn: TODAY,
    expenseId,
    categoryId: '',
    newExpenseId: 'new-expense',
    ...extra,
  });

  it('updates the chosen expense instead of adding a second cost (completion check)', () => {
    const { record, vendor, venueHire } = setUp();
    const forecastBefore = buildLedger(record, CONFIG).forecastPaise;
    const first = agreedQuoteOperations(record, vendor, quote(venueHire.id));
    if (!first.ok) throw new Error(first.issues.join());
    expect(first).toMatchObject({ expenseId: venueHire.id, created: false });
    const once = apply(record, first.operations);
    expect(once.expenses).toHaveLength(record.expenses.length);
    const linked = linkedExpense(once, vendor.id);
    expect(linked).toMatchObject({
      id: venueHire.id,
      commitment: { basis: 'fixed', totalPaise: 11_000_000, depositPaise: 3_000_000 },
    });
    expect(linked?.payments).toEqual([
      {
        id: depositPaymentId(vendor.id),
        amountPaise: 3_000_000,
        date: TODAY,
        note: 'Deposit',
      },
    ]);
    const ledger = buildLedger(once, CONFIG);
    const oldEstimate = record.expenses.find((e) => e.id === venueHire.id);
    expect(oldEstimate?.estimate.basis).toBe('fixed');
    // The agreed total replaces the estimate: counted once.
    expect(ledger.forecastPaise).toBe(
      forecastBefore -
        (oldEstimate?.estimate.basis === 'fixed' ? oldEstimate.estimate.amountPaise : 0) +
        11_000_000,
    );
    expect(ledger.paidPaise).toBe(3_000_000);
    expect(ledger.reconciles).toBe(true);
    expect(once.vendors.find((v) => v.id === vendor.id)?.status).toBe('shortlisted');
  });

  it('repeating it neither duplicates the expense nor double-counts the deposit', () => {
    const { record, vendor, venueHire } = setUp();
    const first = agreedQuoteOperations(record, vendor, quote(venueHire.id));
    if (!first.ok) throw new Error('first');
    const once = apply(record, first.operations);
    // Even asking for a new expense the second time reuses the linked one.
    const again = agreedQuoteOperations(
      once,
      vendor,
      quote('new', { amountPaise: 11_500_000 }),
    );
    if (!again.ok) throw new Error(again.issues.join());
    expect(again.created).toBe(false);
    const twice = apply(once, again.operations);
    expect(twice.expenses).toHaveLength(record.expenses.length);
    expect(twice.expenses.filter((e) => e.vendorId === vendor.id)).toHaveLength(1);
    expect(linkedExpense(twice, vendor.id)?.payments).toHaveLength(1);
    const ledger = buildLedger(twice, CONFIG);
    expect(ledger.paidPaise).toBe(3_000_000);
    expect(ledger.committedPaise).toBe(11_500_000);
  });

  it('creates one new expense when asked, and refuses inconsistent terms', () => {
    const { record, vendor, venueHire } = setUp();
    const created = agreedQuoteOperations(
      record,
      vendor,
      quote('new', { categoryId: venueHire.categoryId, depositPaidOn: undefined }),
    );
    if (!created.ok) throw new Error(created.issues.join());
    expect(created).toMatchObject({ created: true, expenseId: 'new-expense' });
    const next = apply(record, created.operations);
    expect(linkedExpense(next, vendor.id)?.payments).toEqual([]);

    const tooBig = agreedQuoteOperations(
      record,
      vendor,
      quote(venueHire.id, { depositPaise: 20_000_000 }),
    );
    expect(tooBig.ok).toBe(false);
    const other: Vendor = {
      id: 'other',
      name: 'Other',
      kind: 'venue',
      status: 'quoted',
      quotePaise: null,
    };
    const taken = apply(record, [
      { op: 'vendors/upsert', item: other },
      { op: 'expenses/upsert', item: { ...venueHire, vendorId: 'other' } },
    ]);
    const clash = agreedQuoteOperations(taken, vendor, quote(venueHire.id));
    expect(clash).toEqual({
      ok: false,
      issues: ['That expense is already linked to another vendor.'],
    });
  });
});

describe('guests and the forecasting count', () => {
  const guest = (
    id: string,
    partySize: number,
    rsvp: GuestRecord['rsvp'],
  ): GuestRecord => ({
    id,
    name: `Guest ${id}`,
    partySize,
    rsvp,
    dietaryNeeds: [],
    accessibilityNeeds: [],
  });

  it('RSVP edits never change the expected count or the budget (completion check)', () => {
    const record = budgeted(event('wedding'));
    const before = buildLedger(record, CONFIG);
    const next = apply(record, [
      { op: 'guests/upsert', item: guest('a', 4, 'accepted') },
      { op: 'guests/upsert', item: guest('b', 2, 'declined') },
      {
        op: 'guests/upsert',
        item: { ...guest('c', 3, 'invited'), notes: 'One wheelchair user' },
      },
    ]);
    const changed = apply(next, [
      { op: 'guests/upsert', item: guest('b', 2, 'accepted') },
    ]);
    expect(changed.profile.guestCount).toBe(record.profile.guestCount);
    const after = buildLedger(changed, CONFIG);
    expect(after.forecastPaise).toBe(before.forecastPaise);
    expect(after.headroomPaise).toBe(before.headroomPaise);
    expect(guestCountSuggestions(changed)).toEqual([
      { key: 'accepted', label: 'People who accepted', count: 6 },
      { key: 'not-declined', label: 'Accepted plus no reply yet', count: 9 },
    ]);
  });

  it('previews a new count without changing anything, and applies only when asked', () => {
    const record = budgeted(event('wedding'));
    const copy = structuredClone(record);
    const result = previewGuestCount(record, 150, CONFIG, TODAY);
    if (!result.ok) throw new Error(result.reason);
    expect(record).toEqual(copy);
    const { preview } = result;
    expect(preview.after.forecastPaise - preview.before.forecastPaise).toBe(
      preview.before.perGuestPaise * -50,
    );
    expect(preview.lines[0]).toBe(
      'Expected guests: 200 → 150. This is the number every per-guest cost uses.',
    );
    const state = { activeEventId: record.profile.id, events: [record] };
    const applied = plannerReducer(state, {
      type: 'event/edit',
      eventId: record.profile.id,
      operations: preview.operations,
      expectedRevision: preview.baseRevision,
    });
    expect(applied.events[0]?.profile.guestCount).toBe(150);
    // A preview made before another edit is rejected.
    const stale = plannerReducer(applied, {
      type: 'event/edit',
      eventId: record.profile.id,
      operations: preview.operations,
      expectedRevision: preview.baseRevision,
    });
    expect(stale).toBe(applied);
    expect(previewGuestCount(record, 200, CONFIG, TODAY)).toEqual({
      ok: false,
      reason: 'The expected guest count is already 200.',
    });
    expect(previewGuestCount(record, 0, CONFIG, TODAY).ok).toBe(false);
  });
});
