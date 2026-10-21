import type { PlanningConfiguration } from '@/domain/planning/types.ts';
import { birthdayConfiguration } from './birthday.ts';
import { communityConfiguration } from './community.ts';
import { RATES_DISCLOSURE } from './shared.ts';
import { weddingConfiguration } from './wedding.ts';

/** The planner's rules. Typed data, so changing a default is a one-line edit. */
export const PLANNING_CONFIGURATION: PlanningConfiguration = {
  version: '1',
  ratesDisclosure: RATES_DISCLOSURE,
  // Each matching priority raises a category's weight by 30%, capped at 60%, so a
  // priority nudges the plan without letting one category crowd out the rest.
  priorityBoostPercent: 30,
  maxPriorityBoostPercent: 60,
  types: {
    wedding: weddingConfiguration,
    birthday: birthdayConfiguration,
    community: communityConfiguration,
  },
};
