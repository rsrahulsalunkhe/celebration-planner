import { describe, expect, it } from 'vitest';
import { category, expense, makeEvent, task, vendor } from '@/test/helpers.ts';
import { emptySavedState } from './eventRecord.ts';
import { LIMITS } from './primitives.ts';
import {
  assistantMessageSchema,
  eventProfileSchema,
  eventRecordSchema,
  preferencesSchema,
  proposedChangeSchema,
  savedAppStateSchema,
  savedEnvelopeSchema,
} from './schemas.ts';

const profile = makeEvent().profile;
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('eventProfileSchema', () => {
  it('accepts a valid profile', () => {
    expect(ok(eventProfileSchema, profile)).toBe(true);
  });

  it.each([
    ['blank title', { title: '   ' }],
    ['over-long title', { title: 'x'.repeat(101) }],
    ['control characters in title', { title: 'a\u0000b' }],
    ['blank city', { city: '' }],
    ['unknown type', { eventType: 'funeral' }],
    ['impossible date', { date: '2027-02-30' }],
    ['date outside supported years', { date: '1999-12-31' }],
    ['zero guests', { guestCount: 0 }],
    ['fractional guests', { guestCount: 1.5 }],
    ['NaN guests', { guestCount: Number.NaN }],
    ['Infinity guests', { guestCount: Number.POSITIVE_INFINITY }],
    ['too many guests', { guestCount: LIMITS.guestCount + 1 }],
    ['zero budget', { budgetPaise: 0 }],
    ['negative budget', { budgetPaise: -100 }],
    ['fractional paise', { budgetPaise: 100.5 }],
    ['unsafe integer budget', { budgetPaise: Number.MAX_SAFE_INTEGER + 2 }],
    ['budget above the limit', { budgetPaise: LIMITS.maxMoneyPaise + 1 }],
    ['string budget', { budgetPaise: '1000' }],
    ['negative revision', { revision: -1 }],
    ['age band on a non-birthday', { ageBand: '30-49' }],
    ['exact birth date smuggled in', { eventType: 'birthday', ageBand: '1990-05-01' }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(eventProfileSchema, { ...profile, ...patch })).toBe(false);
  });

  it('allows an age band for birthdays', () => {
    expect(
      ok(eventProfileSchema, { ...profile, eventType: 'birthday', ageBand: '30-49' }),
    ).toBe(true);
  });

  it('trims text', () => {
    const parsed = eventProfileSchema.parse({ ...profile, title: '  Hello  ' });
    expect(parsed.title).toBe('Hello');
  });
});

describe('preferencesSchema', () => {
  const base = {
    priorities: [],
    dietaryNeeds: [],
    accessibilityNeeds: [],
    culturalPreferences: [],
  };

  it('accepts empty and populated preferences', () => {
    expect(ok(preferencesSchema, base)).toBe(true);
    expect(
      ok(preferencesSchema, {
        ...base,
        priorities: ['food'],
        accessibilityNeeds: ['wheelchair-access'],
        culturalPreferences: ['Haldi ceremony'],
      }),
    ).toBe(true);
  });

  it.each([
    ['unknown priority', { priorities: ['nonsense'] }],
    ['duplicate priority', { priorities: ['food', 'food'] }],
    [
      'too many priorities',
      {
        priorities: [
          'food',
          'venue',
          'photography',
          'decor',
          'ceremony',
          'guest-comfort',
        ],
      },
    ],
    [
      'too many cultural entries',
      { culturalPreferences: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    ],
    ['blank cultural entry', { culturalPreferences: [' '] }],
    ['over-long note', { dietaryNotes: 'x'.repeat(301) }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(preferencesSchema, { ...base, ...patch })).toBe(false);
  });
});

describe('eventRecordSchema', () => {
  it('accepts a record with a consistent plan', () => {
    const record = {
      ...makeEvent(),
      budgetCategories: [category('c1', 500)],
      vendors: [vendor('v1')],
      expenses: [expense('e1', 'c1', 100, { vendorId: 'v1' })],
      tasks: [task('t1', { vendorId: 'v1' })],
    };
    expect(ok(eventRecordSchema, record)).toBe(true);
  });

  it.each([
    ['expense with unknown category', { expenses: [expense('e1', 'missing', 1)] }],
    [
      'expense with unknown vendor',
      {
        budgetCategories: [category('c1', 1)],
        expenses: [expense('e1', 'c1', 1, { vendorId: 'x' })],
      },
    ],
    ['task with unknown vendor', { tasks: [task('t1', { vendorId: 'x' })] }],
    ['duplicate ids', { tasks: [task('t1'), task('t1')] }],
    [
      'duplicate template ids',
      {
        tasks: [
          task('t1', { templateId: 'task.a-b' }),
          task('t2', { templateId: 'task.a-b' }),
        ],
      },
    ],
    [
      'negative estimate',
      { budgetCategories: [category('c1', 1)], expenses: [expense('e1', 'c1', -1)] },
    ],
    [
      'blank-as-zero is not representable',
      { budgetCategories: [{ ...category('c1', 1), plannedPaise: Number.NaN }] },
    ],
    ['bad template id', { tasks: [task('t1', { templateId: 'Not A Template' })] }],
    [
      'unknown origin',
      { budgetCategories: [{ ...category('c1', 1), plannedOrigin: 'guess' }] },
    ],
  ])('rejects %s', (_label, patch) => {
    expect(ok(eventRecordSchema, { ...makeEvent(), ...patch })).toBe(false);
  });

  it('enforces documented collection limits', () => {
    const tasks = Array.from({ length: LIMITS.tasks + 1 }, (_, i) => task(`t${i}`));
    expect(ok(eventRecordSchema, { ...makeEvent(), tasks })).toBe(false);
    expect(ok(eventRecordSchema, { ...makeEvent(), tasks: tasks.slice(1) })).toBe(true);
  });

  it('rejects duplicate payment ids and bounds payments per expense', () => {
    const payment = { id: 'p1', amountPaise: 100, date: '2026-11-01' };
    const withPayments = (payments: unknown[]) => ({
      ...makeEvent(),
      budgetCategories: [category('c1', 1)],
      expenses: [{ ...expense('e1', 'c1', 1), payments }],
    });
    expect(ok(eventRecordSchema, withPayments([payment]))).toBe(true);
    expect(ok(eventRecordSchema, withPayments([payment, payment]))).toBe(false);
    expect(ok(eventRecordSchema, withPayments([{ ...payment, amountPaise: 0 }]))).toBe(
      false,
    );
  });

  it('keeps totals and percentages out of the stored shape', () => {
    const keys = Object.keys(eventRecordSchema.parse(makeEvent()));
    expect(keys.sort()).toEqual(
      [
        'budgetCategories',
        'expenses',
        'guests',
        'ideas',
        'preferences',
        'profile',
        'tasks',
        'vendors',
      ].sort(),
    );
  });
});

describe('savedAppStateSchema', () => {
  it('accepts the empty state and a populated one', () => {
    expect(ok(savedAppStateSchema, emptySavedState)).toBe(true);
    expect(
      ok(savedAppStateSchema, { activeEventId: 'event-1', events: [makeEvent()] }),
    ).toBe(true);
  });

  it('rejects an active id that does not exist and duplicate events', () => {
    expect(
      ok(savedAppStateSchema, { activeEventId: 'nope', events: [makeEvent()] }),
    ).toBe(false);
    expect(
      ok(savedAppStateSchema, {
        activeEventId: null,
        events: [makeEvent(), makeEvent()],
      }),
    ).toBe(false);
  });

  it('enforces the event limit', () => {
    const events = Array.from({ length: LIMITS.events + 1 }, (_, i) =>
      makeEvent(`event-${i}`),
    );
    expect(ok(savedAppStateSchema, { activeEventId: null, events })).toBe(false);
  });
});

describe('savedEnvelopeSchema', () => {
  it('requires the known schema version', () => {
    expect(ok(savedEnvelopeSchema, { schemaVersion: 1, data: emptySavedState })).toBe(
      true,
    );
    expect(ok(savedEnvelopeSchema, { schemaVersion: 2, data: emptySavedState })).toBe(
      false,
    );
  });
});

describe('session-only types', () => {
  it('validates proposed changes and messages', () => {
    const change = {
      id: 'change-1',
      eventId: 'event-1',
      baseRevision: 0,
      source: 'rules',
      summary: 'Raise the guest count',
      rationale: 'Guests rose from 50 to 60.',
      operations: [{ op: 'profile/patch', patch: { guestCount: 60 } }],
      status: 'pending',
    };
    expect(ok(proposedChangeSchema, change)).toBe(true);
    expect(ok(proposedChangeSchema, { ...change, operations: [] })).toBe(false);
    expect(
      ok(proposedChangeSchema, {
        ...change,
        operations: [{ op: 'profile/patch', patch: { guestCount: 0 } }],
      }),
    ).toBe(false);
    expect(ok(assistantMessageSchema, { id: 'm1', role: 'user', content: 'Hello' })).toBe(
      true,
    );
    expect(ok(assistantMessageSchema, { id: 'm1', role: 'user', content: '' })).toBe(
      false,
    );
  });
});
