import type { EventTypeConfiguration } from '@/domain/planning/types.ts';
import {
  accessCategory,
  accessibilityExpenses,
  dietaryExpense,
  rs,
  weatherCoverExpense,
} from './shared.ts';

/**
 * Weddings: food and venue dominate because they scale with a large, mostly
 * seated guest list. Lead times assume a 90-day horizon, a deliberately short
 * minimum for a modest wedding; longer is always better.
 */
/*
 * Category weights approximate each category's usual share of cost under this
 * file's fictional rates, so targets and forecasts start out roughly aligned.
 * They are defaults to change once you have real quotes, not market benchmarks.
 */
export const weddingConfiguration: EventTypeConfiguration = {
  eventType: 'wedding',
  label: 'Wedding',
  planningHorizonDays: 90,
  reasoning:
    'Weddings have many guests, many vendors and fixed ceremony moments. Food and venue take the largest weights because they scale with guest count and are hardest to change late. The default 90-day horizon is a short minimum for a modest wedding; start earlier if you can.',
  categories: [
    {
      id: 'category.venue',
      name: 'Venue',
      weight: 22,
      priorities: ['venue'],
      rationale:
        'The venue sets capacity, date and mood, and is the hardest booking to change.',
    },
    {
      id: 'category.food',
      name: 'Food and drink',
      weight: 26,
      priorities: ['food'],
      rationale: 'Catering is the largest cost and scales with every guest.',
    },
    {
      id: 'category.decor',
      name: 'Decor and flowers',
      weight: 9,
      priorities: ['decor'],
      rationale: 'Decor shapes the look of the venue and ceremony space.',
    },
    {
      id: 'category.media',
      name: 'Photography and video',
      weight: 16,
      priorities: ['photography'],
      rationale:
        'A wedding happens once, so records of it are weighted above a routine party.',
    },
    {
      id: 'category.entertainment',
      name: 'Music and entertainment',
      weight: 9,
      priorities: ['entertainment'],
      rationale: 'Music carries the reception, but costs are mostly fixed.',
    },
    {
      id: 'category.attire',
      name: 'Attire and styling',
      weight: 10,
      priorities: [],
      rationale:
        'Outfits and styling are specific to weddings and fixed per couple, not per guest.',
    },
    {
      id: 'category.ceremony',
      name: 'Ceremony essentials',
      weight: 4,
      priorities: ['ceremony'],
      rationale: 'Ritual and officiant needs are small but essential.',
    },
    {
      id: 'category.transport',
      name: 'Guest transport',
      weight: 3,
      priorities: ['guest-comfort'],
      rationale: 'Moving guests between sites scales with guest count.',
    },
    accessCategory(
      6,
      'Stated accessibility needs are budgeted first, then any remainder is shared by weight.',
    ),
  ],
  expenses: [
    {
      id: 'expense.venue-hire',
      categoryId: 'category.venue',
      name: 'Venue hire',
      rate: { basis: 'fixed', amountPaise: rs(100_000) },
      rationale: 'A fixed hire fee for the venue.',
    },
    weatherCoverExpense('category.venue', 30_000),
    {
      id: 'expense.catering',
      categoryId: 'category.food',
      name: 'Catering',
      rate: { basis: 'per-guest', perGuestPaise: rs(450) },
      rationale: 'Priced per guest, so it rises and falls with the guest list.',
    },
    {
      id: 'expense.beverages',
      categoryId: 'category.food',
      name: 'Beverages',
      rate: { basis: 'per-guest', perGuestPaise: rs(60) },
      rationale: 'Priced per guest.',
    },
    dietaryExpense(30),
    {
      id: 'expense.decor',
      categoryId: 'category.decor',
      name: 'Decor and flowers',
      rate: { basis: 'fixed', amountPaise: rs(40_000) },
      rationale: 'Mostly fixed by the size of the ceremony and reception spaces.',
    },
    {
      id: 'expense.photographer',
      categoryId: 'category.media',
      name: 'Photographer',
      rate: { basis: 'fixed', amountPaise: rs(55_000) },
      rationale: 'A fixed day rate.',
    },
    {
      id: 'expense.video-highlights',
      categoryId: 'category.media',
      name: 'Highlight video',
      rate: { basis: 'fixed', amountPaise: rs(25_000) },
      optional: true,
      rationale: 'A nice extra that can be dropped first if funds run short.',
    },
    {
      id: 'expense.music',
      categoryId: 'category.entertainment',
      name: 'Music or DJ',
      rate: { basis: 'fixed', amountPaise: rs(25_000) },
      rationale: 'A fixed fee for the reception.',
    },
    {
      id: 'expense.sound-lighting',
      categoryId: 'category.entertainment',
      name: 'Extra sound and lighting',
      rate: { basis: 'fixed', amountPaise: rs(15_000) },
      optional: true,
      rationale: 'An upgrade that can be dropped if funds run short.',
    },
    {
      id: 'expense.attire',
      categoryId: 'category.attire',
      name: 'Outfits and styling',
      rate: { basis: 'fixed', amountPaise: rs(45_000) },
      rationale: 'Fixed per couple.',
    },
    {
      id: 'expense.ceremony-essentials',
      categoryId: 'category.ceremony',
      name: 'Ceremony essentials',
      rate: { basis: 'fixed', amountPaise: rs(18_000) },
      rationale: 'Officiant, materials and ritual items.',
    },
    {
      id: 'expense.guest-transport',
      categoryId: 'category.transport',
      name: 'Guest transport',
      rate: { basis: 'per-guest', perGuestPaise: rs(40) },
      optional: true,
      rationale: 'Priced per guest; optional if the venue is easy to reach.',
    },
    ...accessibilityExpenses({
      ramps: rs(15_000),
      stepFree: rs(8_000),
      restrooms: rs(10_000),
      seatingPerGuest: rs(20),
      interpreter: rs(12_000),
      quietSpace: rs(6_000),
      largePrint: rs(3_000),
    }),
  ],
  tasks: [
    {
      id: 'task.set-budget',
      title: 'Confirm the total budget and reserve',
      timing: { kind: 'before', days: 90 },
      importance: 'critical',
      category: 'planning',
      dependsOn: [],
      rationale: 'Every later choice depends on what you can spend.',
    },
    {
      id: 'task.guest-list',
      title: 'Draft the guest list',
      timing: { kind: 'before', days: 85 },
      importance: 'critical',
      category: 'guests',
      dependsOn: ['task.set-budget'],
      rationale: 'Guest count drives venue size, catering and invitations.',
    },
    {
      id: 'task.book-venue',
      title: 'Shortlist and book the venue',
      timing: { kind: 'before', days: 80 },
      importance: 'critical',
      category: 'venue',
      dependsOn: ['task.set-budget', 'task.guest-list'],
      rationale: 'Venues book out first and fix the date and capacity.',
    },
    {
      id: 'task.book-caterer',
      title: 'Choose and book catering',
      timing: { kind: 'before', days: 70 },
      importance: 'critical',
      category: 'food',
      dependsOn: ['task.book-venue', 'task.guest-list'],
      rationale: 'Catering is the largest cost and depends on the venue and headcount.',
    },
    {
      id: 'task.book-photographer',
      title: 'Book the photographer',
      timing: { kind: 'before', days: 65 },
      importance: 'important',
      category: 'suppliers',
      dependsOn: ['task.book-venue'],
      rationale: 'Good photographers book early for a given date.',
    },
    {
      id: 'task.attire',
      title: 'Arrange outfits and fittings',
      timing: { kind: 'before', days: 60 },
      importance: 'important',
      category: 'suppliers',
      dependsOn: ['task.set-budget'],
      rationale: 'Fittings need several rounds, so they take the longest to finish.',
    },
    {
      id: 'task.ceremony-plan',
      title: 'Plan the ceremony you have chosen: its order, who leads it, and materials',
      timing: { kind: 'before', days: 55 },
      importance: 'important',
      category: 'celebration',
      dependsOn: ['task.book-venue'],
      when: { kind: 'priority', anyOf: ['ceremony'] },
      rationale:
        'You chose the ceremony as a priority. No particular tradition is assumed; add your own practices under cultural preferences.',
    },
    {
      id: 'task.check-access',
      title: 'Check access routes, seating and restrooms with the venue',
      timing: { kind: 'before', days: 50 },
      importance: 'critical',
      category: 'access',
      dependsOn: ['task.book-venue'],
      when: { kind: 'accessibility' },
      rationale:
        'You listed accessibility needs, and the venue must confirm each one in writing.',
    },
    {
      id: 'task.send-invites',
      title: 'Send invitations',
      timing: { kind: 'before', days: 45 },
      importance: 'critical',
      category: 'guests',
      dependsOn: ['task.guest-list', 'task.book-venue'],
      rationale: 'Guests need notice, and replies feed the final headcount.',
    },
    {
      id: 'task.dietary-menu',
      title: 'Confirm the menu covers the stated dietary needs',
      timing: { kind: 'before', days: 40 },
      importance: 'critical',
      category: 'food',
      dependsOn: ['task.book-caterer'],
      when: { kind: 'dietary' },
      rationale:
        'You listed dietary needs, so the caterer must confirm the menu before it is fixed.',
    },
    {
      id: 'task.weather-backup',
      title: 'Decide on the backup if outdoor spaces cannot be used',
      timing: { kind: 'before', days: 30 },
      importance: 'important',
      category: 'safety',
      dependsOn: ['task.book-venue'],
      when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
      rationale:
        'Part of the event is outdoors, so agree a backup and the time by which you will choose it. This does not predict weather.',
    },
    {
      id: 'task.transport',
      title: 'Arrange guest transport',
      timing: { kind: 'before', days: 28 },
      importance: 'routine',
      category: 'suppliers',
      dependsOn: ['task.guest-list'],
      rationale: 'Transport depends on the guest list and venues.',
    },
    {
      id: 'task.confirm-rsvps',
      title: 'Confirm RSVPs',
      timing: { kind: 'before', days: 21 },
      importance: 'critical',
      category: 'guests',
      dependsOn: ['task.send-invites'],
      rationale: 'Caterers and venues need a firm number.',
    },
    {
      id: 'task.final-headcount',
      title: 'Give vendors the final headcount',
      timing: { kind: 'before', days: 14 },
      importance: 'critical',
      category: 'guests',
      dependsOn: ['task.confirm-rsvps', 'task.book-caterer'],
      rationale: 'Per-guest costs are fixed by the final headcount.',
    },
    {
      id: 'task.final-walkthrough',
      title: 'Walk through the day with the venue and vendors',
      timing: { kind: 'before', days: 7 },
      importance: 'important',
      category: 'venue',
      dependsOn: ['task.final-headcount', 'task.book-venue'],
      rationale: 'A walkthrough catches gaps while there is still time to fix them.',
    },
    {
      id: 'task.settle-payments',
      title: 'Prepare final vendor payments',
      timing: { kind: 'before', days: 2 },
      importance: 'important',
      category: 'planning',
      dependsOn: ['task.final-headcount'],
      rationale: 'Balances are usually due on or before the day.',
    },
    {
      id: 'task.book-music',
      title: 'Book music or entertainment',
      timing: { kind: 'before', days: 60 },
      importance: 'important',
      category: 'suppliers',
      dependsOn: ['task.book-venue'],
      when: { kind: 'priority', anyOf: ['entertainment'] },
      rationale:
        'You chose entertainment as a priority, and performers book out for popular dates.',
    },
    {
      id: 'task.menu-tasting',
      title: 'Arrange a menu tasting with the caterer',
      timing: { kind: 'before', days: 50 },
      importance: 'important',
      category: 'food',
      dependsOn: ['task.book-caterer'],
      when: { kind: 'priority', anyOf: ['food'] },
      rationale:
        'You chose food as a priority, so taste and adjust the menu before it is fixed.',
    },
    {
      id: 'task.decor-plan',
      title: 'Agree the decor plan with the venue',
      timing: { kind: 'before', days: 40 },
      importance: 'routine',
      category: 'celebration',
      dependsOn: ['task.book-venue'],
      when: { kind: 'priority', anyOf: ['decor'] },
      rationale:
        'You chose decor as a priority. Venues often limit what can be fixed or hung.',
    },
    {
      id: 'task.order-of-day',
      title: 'Draft the order of the day',
      timing: { kind: 'before', days: 30 },
      importance: 'important',
      category: 'celebration',
      dependsOn: ['task.book-venue'],
      rationale:
        'Times for arrivals, meals, speeches and departures, in whatever form your celebration takes. It becomes the running order for the day.',
    },
    {
      id: 'task.run-the-day',
      title: 'Run the day from the running order',
      timing: { kind: 'on-day' },
      importance: 'critical',
      category: 'celebration',
      dependsOn: ['task.final-walkthrough', 'task.order-of-day'],
      rationale:
        'One named person keeps time and is the contact for vendors, so the couple and family do not have to.',
    },
    {
      id: 'task.thank-you',
      title: 'Send thank-you messages',
      timing: { kind: 'after', days: 7 },
      importance: 'routine',
      category: 'wrap-up',
      dependsOn: ['task.final-walkthrough'],
      rationale: 'An explicit follow-up that happens after the wedding.',
    },
    {
      id: 'task.settle-balances',
      title: 'Settle remaining vendor balances',
      timing: { kind: 'after', days: 3 },
      importance: 'important',
      category: 'wrap-up',
      dependsOn: ['task.settle-payments'],
      rationale: 'An explicit follow-up for any balances due after the wedding.',
    },
  ],
  vendorChecklists: [
    {
      id: 'checklist.venue',
      vendorKind: 'venue',
      title: 'Venue questions',
      items: [
        {
          text: 'Confirm capacity for {guests} guests, seated for the meal and for the ceremony.',
        },
        { text: 'Ask what is included in the hire fee and what is charged extra.' },
        { text: 'Ask about power backup, parking and the closing time in {city}.' },
        { text: 'Ask for the cancellation terms and the deposit schedule in writing.' },
        {
          text: 'Ask for the covered or indoor alternative if outdoor spaces cannot be used.',
          when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
        },
        {
          text: 'Ask for a written confirmation of each accessibility need you listed.',
          when: { kind: 'accessibility' },
        },
      ],
    },
    {
      id: 'checklist.catering',
      vendorKind: 'catering',
      title: 'Caterer questions',
      items: [
        {
          text: 'Ask for a price per guest, so you can see the cost at {guests} guests and at other headcounts.',
        },
        { text: 'Arrange a tasting before you pay a deposit.' },
        { text: 'Ask how late the final headcount can change.' },
        {
          text: 'Confirm which dishes meet the dietary needs you listed and how they are kept separate.',
          when: { kind: 'dietary' },
        },
      ],
    },
    {
      id: 'checklist.photography',
      vendorKind: 'photography',
      title: 'Photographer questions',
      items: [
        { text: 'Agree the key moments to capture on {date}.' },
        { text: 'Ask how many edited photos you receive and by when.' },
        { text: 'Ask what happens if the photographer is ill on the day.' },
      ],
    },
    {
      id: 'checklist.music',
      vendorKind: 'music',
      title: 'Music and sound questions',
      items: [
        { text: 'Ask about the venue sound limit and the end time.' },
        { text: 'Share the ceremony and reception running order.' },
      ],
    },
  ],
  ideaTags: [
    { tag: 'ceremony', label: 'Ceremony' },
    { tag: 'reception', label: 'Reception' },
    { tag: 'keepsake', label: 'Keepsakes' },
    { tag: 'guest-welcome', label: 'Guest welcome' },
    { tag: 'photography', label: 'Photography' },
  ],
  ideas: [
    {
      id: 'idea.wedding-welcome-notes',
      title: 'Handwritten welcome notes',
      details:
        'A short note at each place setting makes {guests} guests feel personally welcomed, at very little cost.',
      kind: 'favour',
      tags: ['guest-welcome', 'keepsake'],
    },
    {
      id: 'idea.wedding-memory-table',
      title: 'A memory table',
      details:
        'Photos and notes from family give the reception a personal focus and cost little.',
      kind: 'activity',
      tags: ['keepsake', 'reception'],
    },
    {
      id: 'idea.wedding-photo-moments',
      title: 'A short list of must-have photographs',
      details:
        'You chose photography as a priority. Agree a short list of moments with the photographer so none are missed on {date}.',
      kind: 'activity',
      tags: ['photography', 'ceremony'],
      when: { kind: 'priority', anyOf: ['photography'] },
    },
    {
      id: 'idea.wedding-shade-fans',
      title: 'Shade and fans for outdoor moments',
      details:
        'Part of the event is outdoors in {city}. Shade, water and fans keep guests comfortable during the ceremony.',
      kind: 'decor',
      tags: ['guest-welcome', 'ceremony'],
      when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
    },
    {
      id: 'idea.wedding-quiet-corner',
      title: 'A quiet corner during the reception',
      details:
        'You listed accessibility needs. A quiet corner with seating gives guests a place to rest away from the music.',
      kind: 'activity',
      tags: ['guest-welcome', 'reception'],
      when: { kind: 'accessibility' },
    },
  ],
  culturalPractice: {
    leadDays: 60,
    taskRationale:
      'You listed this as a cultural preference. The planner does not add practices you did not ask for, so confirm with your family how it is usually done.',
    ideaDetails:
      'You listed this as a cultural preference. Ask the people who know it best how they would like it included.',
  },
};
