import type { z } from 'zod';
import type {
  celebrationEventSchema,
  eventTypeSchema,
  persistedPlannerSchema,
  plannerStateSchema,
} from './schemas.ts';

// Types are derived from the Zod schemas so validation and typing cannot drift.
export type EventType = z.infer<typeof eventTypeSchema>;
export type CelebrationEvent = z.infer<typeof celebrationEventSchema>;
export type PlannerState = z.infer<typeof plannerStateSchema>;
export type PersistedPlanner = z.infer<typeof persistedPlannerSchema>;

/** `YYYY-MM-DD`, no time zone. */
export type IsoDate = string;
