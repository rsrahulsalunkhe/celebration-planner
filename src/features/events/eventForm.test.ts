import { describe, expect, it } from 'vitest';
import { makeEvent } from '@/test/helpers.ts';
import {
  emptyFormValues,
  validateEventForm,
  valuesFromRecord,
  type EventFormValues,
} from './eventForm.ts';

const valid: EventFormValues = {
  ...emptyFormValues,
  title: '  Asha’s 40th  ',
  eventType: 'birthday',
  date: '2027-03-10',
  city: 'Pune',
  guestCount: '40',
  budget: '50,000',
  setting: 'indoor',
  ageBand: '30-49',
  priorities: ['food'],
  culturalPreferences: 'Garba night, , Vegetarian menu\nLive music',
};

describe('validateEventForm', () => {
  it('turns valid text into integer paise and clean preferences', () => {
    const result = validateEventForm(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({
      title: 'Asha’s 40th',
      budgetPaise: 5_000_000,
      guestCount: 40,
      ageBand: '30-49',
    });
    expect(result.preferences.culturalPreferences).toEqual([
      'Garba night',
      'Vegetarian menu',
      'Live music',
    ]);
  });

  it('accepts paise and ignores the age band for non-birthdays', () => {
    const result = validateEventForm({
      ...valid,
      eventType: 'wedding',
      budget: '₹1,25,000.50',
    });
    expect(result.ok && result.profile.budgetPaise).toBe(12_500_050);
    expect(result.ok && 'ageBand' in result.profile).toBe(false);
  });

  it('reports blank required fields instead of defaulting them', () => {
    const result = validateEventForm(emptyFormValues);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ['budget', 'city', 'date', 'eventType', 'guestCount', 'setting', 'title'].sort(),
    );
  });

  it.each([
    ['blank budget', { budget: '' }, 'budget'],
    ['whitespace budget', { budget: '   ' }, 'budget'],
    ['zero budget', { budget: '0' }, 'budget'],
    ['negative budget', { budget: '-5' }, 'budget'],
    ['three decimals', { budget: '10.123' }, 'budget'],
    ['text budget', { budget: 'lots' }, 'budget'],
    ['budget over the limit', { budget: '99999999999999' }, 'budget'],
    ['blank guests', { guestCount: '' }, 'guestCount'],
    ['zero guests', { guestCount: '0' }, 'guestCount'],
    ['decimal guests', { guestCount: '2.5' }, 'guestCount'],
    ['negative guests', { guestCount: '-3' }, 'guestCount'],
    ['exponent guests', { guestCount: '1e3' }, 'guestCount'],
    ['huge guests', { guestCount: '9'.repeat(400) }, 'guestCount'],
    ['too many guests', { guestCount: '5001' }, 'guestCount'],
    ['impossible date', { date: '2027-02-30' }, 'date'],
    ['blank date', { date: '' }, 'date'],
    ['whitespace title', { title: '   ' }, 'title'],
    [
      'too many cultural preferences',
      { culturalPreferences: Array.from({ length: 11 }, (_, i) => `t${i}`).join(',') },
      'culturalPreferences',
    ],
    [
      'too many priorities',
      {
        priorities: [
          'food',
          'venue',
          'decor',
          'ceremony',
          'photography',
          'guest-comfort',
        ] as EventFormValues['priorities'],
      },
      'priorities',
    ],
  ])('rejects %s with an error on %s', (_label, patch, field) => {
    const result = validateEventForm({ ...valid, ...patch });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[field as keyof EventFormValues]).toBeTruthy();
  });
});

describe('valuesFromRecord', () => {
  it('round-trips an event through the form unchanged', () => {
    const record = makeEvent('e', { budgetPaise: 12_500_050 });
    const result = validateEventForm(valuesFromRecord(record));
    expect(result.ok && result.profile).toMatchObject({
      title: record.profile.title,
      budgetPaise: 12_500_050,
      guestCount: record.profile.guestCount,
    });
  });
});

describe('new events cannot be in the past', () => {
  it('rejects a past date only when creating, never when editing', () => {
    const past = { ...valid, date: '2026-10-20' };
    const created = validateEventForm(past, { newEventToday: '2026-10-21' });
    expect(created.ok).toBe(false);
    expect(!created.ok && created.errors.date).toMatch(/today or a later date/);

    expect(validateEventForm(past).ok).toBe(true); // an edit of history is allowed
    expect(
      validateEventForm({ ...valid, date: '2026-10-21' }, { newEventToday: '2026-10-21' })
        .ok,
    ).toBe(true);
    expect(
      validateEventForm({ ...valid, date: '2026-10-22' }, { newEventToday: '2026-10-21' })
        .ok,
    ).toBe(true);
  });
});
