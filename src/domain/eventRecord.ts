import type { EventProfile, EventRecord, Preferences, SavedAppState } from './types.ts';

export const emptySavedState: SavedAppState = { activeEventId: null, events: [] };

export const emptyPreferences: Preferences = {
  priorities: [],
  dietaryNeeds: [],
  accessibilityNeeds: [],
  culturalPreferences: [],
};

/** A new event: revision 0 and empty collections. Nothing is generated here. */
export function createEventRecord(
  profile: Omit<EventProfile, 'revision'>,
  preferences: Preferences = emptyPreferences,
): EventRecord {
  return {
    profile: { ...profile, revision: 0 },
    preferences,
    budgetCategories: [],
    expenses: [],
    tasks: [],
    vendors: [],
    guests: [],
    ideas: [],
  };
}
