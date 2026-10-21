import type { EventTypeConfiguration } from '@/domain/planning/types.ts';
import {
  accessCategory,
  accessibilityExpenses,
  dietaryExpense,
  rs,
  weatherCoverExpense,
} from './shared.ts';

/**
 * Birthdays: smaller guest lists and short planning windows, so entertainment
 * carries more weight than at a wedding and the venue far less. The default
 * horizon is 14 days. Age band, when the user gives one, only changes which
 * activities are suggested; it never changes who is invited.
 */
/*
 * Category weights approximate each category's usual share of cost under this
 * file's fictional rates, so targets and forecasts start out roughly aligned.
 * They are defaults to change once you have real quotes, not market benchmarks.
 */
export const birthdayConfiguration: EventTypeConfiguration = {
  eventType: 'birthday',
  label: 'Birthday',
  planningHorizonDays: 14,
  reasoning:
    'Birthdays are smaller and faster to plan. Entertainment and food matter most to how the day feels, while the venue is often a home or small hall. The default 14-day horizon fits a typical party; the age band, if given, only tailors activity suggestions.',
  categories: [
    {
      id: 'category.venue',
      name: 'Venue or hall',
      weight: 16,
      priorities: ['venue'],
      rationale: 'A small hall or room is usually a modest fixed fee.',
    },
    {
      id: 'category.food',
      name: 'Food, drink and cake',
      weight: 40,
      priorities: ['food'],
      rationale:
        'Food and cake are the heart of most birthday parties and scale with guests.',
    },
    {
      id: 'category.decor',
      name: 'Decor',
      weight: 11,
      priorities: ['decor'],
      rationale: 'A little decor changes the feel of a room for little money.',
    },
    {
      id: 'category.entertainment',
      name: 'Entertainment and activities',
      weight: 16,
      priorities: ['entertainment'],
      rationale:
        'Activities carry a birthday party, so they are weighted higher than at a wedding.',
    },
    {
      id: 'category.favours',
      name: 'Return gifts',
      weight: 7,
      priorities: [],
      rationale: 'Small thank-you gifts scale per guest and are optional.',
    },
    {
      id: 'category.media',
      name: 'Photography',
      weight: 8,
      priorities: ['photography'],
      rationale: 'A few photos are enough for most parties.',
    },
    accessCategory(
      5,
      'Stated accessibility needs are budgeted first, then any remainder is shared by weight.',
    ),
  ],
  expenses: [
    {
      id: 'expense.venue-hire',
      categoryId: 'category.venue',
      name: 'Hall or room hire',
      rate: { basis: 'fixed', amountPaise: rs(6_000) },
      rationale: 'A fixed hire fee.',
    },
    weatherCoverExpense('category.venue', 3_000),
    {
      id: 'expense.catering',
      categoryId: 'category.food',
      name: 'Food',
      rate: { basis: 'per-guest', perGuestPaise: rs(300) },
      rationale: 'Priced per guest.',
    },
    {
      id: 'expense.beverages',
      categoryId: 'category.food',
      name: 'Drinks',
      rate: { basis: 'per-guest', perGuestPaise: rs(40) },
      rationale: 'Priced per guest.',
    },
    {
      id: 'expense.cake',
      categoryId: 'category.food',
      name: 'Cake',
      rate: { basis: 'fixed', amountPaise: rs(3_000) },
      rationale: 'One cake is a fixed cost for a party of this size.',
    },
    dietaryExpense(15),
    {
      id: 'expense.decor',
      categoryId: 'category.decor',
      name: 'Decor and balloons',
      rate: { basis: 'fixed', amountPaise: rs(4_000) },
      rationale: 'A fixed amount for a small room.',
    },
    {
      id: 'expense.music',
      categoryId: 'category.entertainment',
      name: 'Speaker and playlist or DJ',
      rate: { basis: 'fixed', amountPaise: rs(3_000) },
      rationale: 'A fixed fee.',
    },
    {
      id: 'expense.kids-activities',
      categoryId: 'category.entertainment',
      name: 'Activities for younger guests',
      rate: { basis: 'fixed', amountPaise: rs(4_500) },
      when: { kind: 'ageBand', anyOf: ['under-13', '13-17'] },
      rationale: 'You gave a younger age band, so supervised activities are budgeted.',
    },
    {
      id: 'expense.return-gifts',
      categoryId: 'category.favours',
      name: 'Return gifts',
      rate: { basis: 'per-guest', perGuestPaise: rs(60) },
      optional: true,
      rationale: 'Priced per guest; optional.',
    },
    {
      id: 'expense.photographer',
      categoryId: 'category.media',
      name: 'Photographer',
      rate: { basis: 'fixed', amountPaise: rs(5_000) },
      optional: true,
      rationale:
        'A friend with a phone camera is a free alternative, so this is optional.',
    },
    ...accessibilityExpenses({
      ramps: rs(3_000),
      stepFree: rs(1_500),
      restrooms: rs(2_500),
      seatingPerGuest: rs(10),
      interpreter: rs(5_000),
      quietSpace: rs(1_000),
      largePrint: rs(500),
    }),
  ],
  tasks: [
    {
      id: 'task.set-budget',
      title: 'Confirm the budget and reserve',
      timing: { kind: 'before', days: 14 },
      importance: 'critical',
      dependsOn: [],
      rationale: 'Choices on the guest list, venue and food all depend on it.',
    },
    {
      id: 'task.guest-list',
      title: 'Decide who to invite',
      timing: { kind: 'before', days: 14 },
      importance: 'critical',
      dependsOn: ['task.set-budget'],
      rationale: 'Headcount drives food, space and invitations.',
    },
    {
      id: 'task.book-venue',
      title: 'Pick and book the place',
      timing: { kind: 'before', days: 12 },
      importance: 'critical',
      dependsOn: ['task.set-budget', 'task.guest-list'],
      rationale: 'Halls fill up on weekends, even at short notice.',
    },
    {
      id: 'task.send-invites',
      title: 'Send invitations',
      timing: { kind: 'before', days: 10 },
      importance: 'critical',
      dependsOn: ['task.guest-list', 'task.book-venue'],
      rationale: 'Guests need a few days of notice.',
    },
    {
      id: 'task.book-caterer',
      title: 'Order food or book a caterer',
      timing: { kind: 'before', days: 9 },
      importance: 'important',
      dependsOn: ['task.book-venue', 'task.guest-list'],
      rationale: 'Food is the largest per-guest cost.',
    },
    {
      id: 'task.check-access',
      title: 'Check the entrance, seating and restrooms suit every guest',
      timing: { kind: 'before', days: 8 },
      importance: 'critical',
      dependsOn: ['task.book-venue'],
      when: { kind: 'accessibility' },
      rationale: 'You listed accessibility needs, so confirm each one with the venue.',
    },
    {
      id: 'task.cake-order',
      title: 'Order the cake',
      timing: { kind: 'before', days: 7 },
      importance: 'important',
      dependsOn: ['task.guest-list'],
      rationale: 'Cakes are made to order and sized to the guest count.',
    },
    {
      id: 'task.book-entertainment',
      title: 'Arrange music or activities',
      timing: { kind: 'before', days: 7 },
      importance: 'important',
      dependsOn: ['task.set-budget'],
      rationale: 'Entertainment carries a birthday party.',
    },
    {
      id: 'task.dietary-menu',
      title: 'Check the food suits the stated dietary needs',
      timing: { kind: 'before', days: 7 },
      importance: 'critical',
      dependsOn: ['task.book-caterer'],
      when: { kind: 'dietary' },
      rationale:
        'You listed dietary needs, so confirm them with whoever prepares the food.',
    },
    {
      id: 'task.age-activities',
      title: 'Plan activities that suit the age group',
      timing: { kind: 'before', days: 5 },
      importance: 'routine',
      dependsOn: ['task.book-venue'],
      when: { kind: 'ageBand', anyOf: ['under-13', '13-17', '65-plus'] },
      rationale: 'You gave an age band, so activities are matched to it.',
    },
    {
      id: 'task.weather-backup',
      title: 'Choose the backup if the outdoor space cannot be used',
      timing: { kind: 'before', days: 5 },
      importance: 'important',
      dependsOn: ['task.book-venue'],
      when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
      rationale:
        'Part of the party is outdoors, so agree a backup. This does not predict weather.',
    },
    {
      id: 'task.confirm-rsvps',
      title: 'Confirm who is coming',
      timing: { kind: 'before', days: 4 },
      importance: 'critical',
      dependsOn: ['task.send-invites'],
      rationale: 'A firm headcount fixes food and cake quantities.',
    },
    {
      id: 'task.final-shopping',
      title: 'Collect cake, decor and supplies',
      timing: { kind: 'before', days: 2 },
      importance: 'routine',
      dependsOn: ['task.cake-order', 'task.confirm-rsvps'],
      rationale: 'Last-minute collection once the headcount is firm.',
    },
    {
      id: 'task.thank-you',
      title: 'Send thank-you messages',
      timing: { kind: 'after', days: 3 },
      importance: 'routine',
      dependsOn: ['task.final-shopping'],
      rationale: 'An explicit follow-up that happens after the party.',
    },
  ],
  vendorChecklists: [
    {
      id: 'checklist.venue',
      vendorKind: 'venue',
      title: 'Hall or room questions',
      items: [
        { text: 'Confirm the room comfortably fits {guests} guests.' },
        { text: 'Ask about the hours you get, including set-up and clean-up.' },
        { text: 'Ask whether outside food and cake are allowed.' },
        {
          text: 'Ask for a written confirmation of each accessibility need you listed.',
          when: { kind: 'accessibility' },
        },
      ],
    },
    {
      id: 'checklist.catering',
      vendorKind: 'catering',
      title: 'Food and cake questions',
      items: [
        { text: 'Ask for a price per guest for {guests} guests.' },
        { text: 'Ask how late the cake size and headcount can change.' },
        {
          text: 'Check the cake and menu for the dietary needs you listed.',
          when: { kind: 'dietary' },
        },
      ],
    },
    {
      id: 'checklist.entertainment',
      vendorKind: 'music',
      title: 'Entertainment questions',
      items: [
        {
          text: 'Ask for activities that suit the age band you chose.',
          when: { kind: 'ageBand', anyOf: ['under-13', '13-17', '65-plus'] },
        },
        { text: 'Check the sound level suits the room and the neighbours in {city}.' },
      ],
    },
  ],
  ideaTags: [
    { tag: 'party-games', label: 'Party games' },
    { tag: 'surprise', label: 'Surprises' },
    { tag: 'cake', label: 'Cake' },
    { tag: 'milestone', label: 'Milestone moments' },
    { tag: 'age-fit', label: 'Suited to the age group' },
  ],
  ideas: [
    {
      id: 'idea.birthday-game-stations',
      title: 'Game stations',
      details:
        'With {guests} guests, two or three small game stations keep people mixing without needing one big organised game.',
      kind: 'activity',
      tags: ['party-games'],
      when: { kind: 'guests', max: 60 },
    },
    {
      id: 'idea.birthday-toast-wall',
      title: 'A wall of good wishes',
      details:
        'Guests write short notes for the guest of honour on arrival, which gives everyone something to do and a keepsake at the end.',
      kind: 'activity',
      tags: ['milestone', 'surprise'],
    },
    {
      id: 'idea.birthday-cake-moment',
      title: 'A planned cake moment',
      details:
        'Agree the time for the cake in advance so photos and a short toast happen while everyone is together.',
      kind: 'food',
      tags: ['cake', 'milestone'],
    },
    {
      id: 'idea.birthday-craft-table',
      title: 'A craft table',
      details:
        'You gave a younger age band, so a supervised craft table gives children something calm to do.',
      kind: 'activity',
      tags: ['age-fit', 'party-games'],
      when: { kind: 'ageBand', anyOf: ['under-13'] },
    },
    {
      id: 'idea.birthday-seated-lounge',
      title: 'A seated lounge area',
      details:
        'You gave an older age band, so a comfortable seated area with easy access to food keeps the day relaxed.',
      kind: 'theme',
      tags: ['age-fit'],
      when: { kind: 'ageBand', anyOf: ['50-64', '65-plus'] },
    },
    {
      id: 'idea.birthday-photo-corner',
      title: 'A photo corner',
      details: 'A small backdrop gives guests a spot for photos and costs very little.',
      kind: 'decor',
      tags: ['milestone'],
      when: { kind: 'priority', anyOf: ['photography', 'decor'] },
    },
  ],
  culturalPractice: {
    leadDays: 10,
    taskRationale:
      'You listed this as a cultural preference. The planner does not add practices you did not ask for, so confirm how it is usually done.',
    ideaDetails:
      'You listed this as a cultural preference. Ask the people who know it best how they would like it included.',
  },
};
