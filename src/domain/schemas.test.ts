import { describe, expect, it } from 'vitest';
import { sampleWedding } from '@/data/fixtures.ts';
import { celebrationEventSchema, persistedPlannerSchema } from './schemas.ts';

describe('celebrationEventSchema', () => {
  it('accepts the sample fixture', () => {
    expect(celebrationEventSchema.safeParse(sampleWedding).success).toBe(true);
  });

  it.each([
    ['empty name', { name: '  ' }],
    ['unknown type', { type: 'funeral' }],
    ['impossible date', { date: '2027-02-30' }],
    ['zero guests', { guestCount: 0 }],
    ['fractional budget', { budget: 10.5 }],
    ['negative budget', { budget: -1 }],
    ['lowercase currency', { currency: 'inr' }],
  ])('rejects %s', (_label, patch) => {
    expect(celebrationEventSchema.safeParse({ ...sampleWedding, ...patch }).success).toBe(
      false,
    );
  });
});

describe('persistedPlannerSchema', () => {
  it('requires a known version', () => {
    expect(
      persistedPlannerSchema.safeParse({ version: 2, state: { event: null } }).success,
    ).toBe(false);
  });
});
