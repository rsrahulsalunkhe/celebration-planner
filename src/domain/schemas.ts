import { z } from 'zod';

export const EVENT_TYPES = ['wedding', 'birthday', 'community'] as const;

export const eventTypeSchema = z.enum(EVENT_TYPES);

/** Calendar date without a time zone, e.g. `2027-02-13`. */
export const isoDateSchema = z.iso.date();

/** Integer amount in the currency's minor unit (cents, paise, ...). */
export const minorUnitsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter code');

export const celebrationEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  type: eventTypeSchema,
  date: isoDateSchema,
  guestCount: z.number().int().min(1).max(5000),
  budget: minorUnitsSchema,
  currency: currencyCodeSchema,
  city: z.string().trim().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

export const plannerStateSchema = z.object({
  event: celebrationEventSchema.nullable(),
});

/** Versioned envelope written to localStorage and to JSON exports. */
export const persistedPlannerSchema = z.object({
  version: z.literal(1),
  state: plannerStateSchema,
});
