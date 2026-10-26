import type { EventTypeConfiguration } from '@/domain/planning/types.ts';
import {
  accessCategory,
  accessibilityExpenses,
  dietaryExpense,
  rs,
  weatherCoverExpense,
} from './shared.ts';

/**
 * Community events: no ceremony, many volunteers, often outdoors and often
 * open to the public. Site, equipment and safety weigh far more than at a
 * wedding or birthday, and permissions come first. The default horizon is 30
 * days.
 */
/*
 * Category weights approximate each category's usual share of cost under this
 * file's fictional rates, so targets and forecasts start out roughly aligned.
 * They are defaults to change once you have real quotes, not market benchmarks.
 */
export const communityConfiguration: EventTypeConfiguration = {
  eventType: 'community',
  label: 'Community event',
  planningHorizonDays: 30,
  reasoning:
    'Community events depend on permissions, volunteers and equipment more than on food or decor. Site, equipment and safety take the largest weights, and permissions are the first dependency. The default 30-day horizon allows time for approvals and volunteer recruitment.',
  categories: [
    {
      id: 'category.venue',
      name: 'Site and permissions',
      weight: 14,
      priorities: ['venue'],
      rationale: 'The site and its permissions come before everything else.',
    },
    {
      id: 'category.food',
      name: 'Refreshments',
      weight: 14,
      priorities: ['food'],
      rationale: 'Refreshments are the main per-guest cost.',
    },
    {
      id: 'category.equipment',
      name: 'Tents, seating and sound',
      weight: 40,
      priorities: ['guest-comfort', 'entertainment'],
      rationale:
        'Shelter, seating and sound are needed at a public gathering and are mostly fixed hire costs.',
    },
    {
      id: 'category.publicity',
      name: 'Publicity',
      weight: 6,
      priorities: [],
      rationale: 'People must know about the event to come to it.',
    },
    {
      id: 'category.volunteers',
      name: 'Volunteer support',
      weight: 4,
      priorities: ['sustainability'],
      rationale:
        'Volunteers are the workforce, so water, food and identification for them are budgeted.',
    },
    {
      id: 'category.safety',
      name: 'Safety and first aid',
      weight: 9,
      priorities: ['guest-comfort'],
      rationale:
        'Public events carry safety duties, so this is weighted above a private party.',
    },
    accessCategory(
      8,
      'Stated accessibility needs are budgeted first, then any remainder is shared by weight.',
    ),
  ],
  expenses: [
    {
      id: 'expense.site-fee',
      categoryId: 'category.venue',
      name: 'Site fee',
      rate: { basis: 'fixed', amountPaise: rs(15_000) },
      rationale: 'A fixed fee for the ground or hall.',
    },
    {
      id: 'expense.permits',
      categoryId: 'category.venue',
      name: 'Permissions and fees',
      rate: { basis: 'fixed', amountPaise: rs(5_000) },
      rationale: 'Local permissions are often needed for a public gathering.',
    },
    weatherCoverExpense('category.equipment', 20_000),
    {
      id: 'expense.refreshments',
      categoryId: 'category.food',
      name: 'Refreshments',
      rate: { basis: 'per-guest', perGuestPaise: rs(120) },
      rationale: 'Priced per guest.',
    },
    dietaryExpense(15),
    {
      id: 'expense.tents-chairs',
      categoryId: 'category.equipment',
      name: 'Tents, tables and chairs',
      rate: { basis: 'fixed', amountPaise: rs(30_000) },
      rationale: 'A fixed hire cost.',
    },
    {
      id: 'expense.sound-system',
      categoryId: 'category.equipment',
      name: 'Sound system',
      rate: { basis: 'fixed', amountPaise: rs(10_000) },
      rationale: 'A fixed hire cost.',
    },
    {
      id: 'expense.power-lighting',
      categoryId: 'category.equipment',
      name: 'Power and lighting',
      rate: { basis: 'fixed', amountPaise: rs(8_000) },
      rationale: 'Outdoor sites often have no power.',
    },
    {
      id: 'expense.publicity',
      categoryId: 'category.publicity',
      name: 'Posters and notices',
      rate: { basis: 'fixed', amountPaise: rs(8_000) },
      optional: true,
      rationale:
        'Word of mouth and free channels can replace some of this, so it is optional.',
    },
    {
      id: 'expense.volunteer-support',
      categoryId: 'category.volunteers',
      name: 'Volunteer water, meals and badges',
      rate: { basis: 'per-guest', perGuestPaise: rs(20) },
      rationale: 'Volunteer numbers rise with attendance, so this scales with guests.',
    },
    {
      id: 'expense.first-aid',
      categoryId: 'category.safety',
      name: 'First aid cover',
      rate: { basis: 'fixed', amountPaise: rs(6_000) },
      rationale: 'Public events should have first aid on site.',
    },
    {
      id: 'expense.signage-barriers',
      categoryId: 'category.safety',
      name: 'Signage and barriers',
      rate: { basis: 'fixed', amountPaise: rs(5_000) },
      rationale: 'Clear signs and barriers keep crowds safe.',
    },
    ...accessibilityExpenses({
      ramps: rs(15_000),
      stepFree: rs(8_000),
      restrooms: rs(12_000),
      seatingPerGuest: rs(10),
      interpreter: rs(10_000),
      quietSpace: rs(4_000),
      largePrint: rs(2_000),
    }),
  ],
  tasks: [
    {
      id: 'task.set-budget',
      title: 'Confirm the budget, funding and reserve',
      timing: { kind: 'before', days: 30 },
      importance: 'critical',
      category: 'planning',
      dependsOn: [],
      rationale: 'Everything else depends on what is funded.',
    },
    {
      id: 'task.permissions',
      title: 'Check and apply for local permissions',
      timing: { kind: 'before', days: 28 },
      importance: 'critical',
      category: 'safety',
      dependsOn: ['task.set-budget'],
      rationale: 'Approvals can take weeks and gate the site booking.',
    },
    {
      id: 'task.book-site',
      title: 'Book the site in writing',
      timing: { kind: 'before', days: 26 },
      importance: 'critical',
      category: 'venue',
      dependsOn: ['task.permissions'],
      rationale: 'The site must be confirmed once permissions are in place.',
    },
    {
      id: 'task.volunteer-roster',
      title: 'Recruit volunteers and build the roster',
      timing: { kind: 'before', days: 21 },
      importance: 'critical',
      category: 'volunteers',
      dependsOn: ['task.set-budget'],
      rationale: 'Volunteers run the event, and rosters take time to fill.',
    },
    {
      id: 'task.publicise',
      title: 'Publicise the event',
      timing: { kind: 'before', days: 21 },
      importance: 'important',
      category: 'guests',
      dependsOn: ['task.book-site'],
      rationale: 'Attendance depends on people knowing the date and place.',
    },
    {
      id: 'task.check-access',
      title: 'Check access routes, seating and restrooms on site',
      timing: { kind: 'before', days: 21 },
      importance: 'critical',
      category: 'access',
      dependsOn: ['task.book-site'],
      when: { kind: 'accessibility' },
      rationale:
        'You listed accessibility needs, and the site must be checked for each one.',
    },
    {
      id: 'task.equipment',
      title: 'Reserve tents, seating and sound',
      timing: { kind: 'before', days: 14 },
      importance: 'important',
      category: 'suppliers',
      dependsOn: ['task.book-site'],
      rationale: 'Hire equipment is booked once the site and layout are known.',
    },
    {
      id: 'task.safety-plan',
      title: 'Write the safety and first-aid plan',
      timing: { kind: 'before', days: 14 },
      importance: 'critical',
      category: 'safety',
      dependsOn: ['task.book-site', 'task.volunteer-roster'],
      rationale: 'Public gatherings need a plan for crowds, first aid and emergencies.',
    },
    {
      id: 'task.weather-backup',
      title: 'Decide the backup if the outdoor site cannot be used',
      timing: { kind: 'before', days: 14 },
      importance: 'important',
      category: 'safety',
      dependsOn: ['task.book-site'],
      when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
      rationale:
        'The event is outdoors, so agree a backup and a decision time. This does not predict weather.',
    },
    {
      id: 'task.dietary-menu',
      title: 'Confirm refreshments suit the stated dietary needs',
      timing: { kind: 'before', days: 12 },
      importance: 'critical',
      category: 'food',
      dependsOn: ['task.book-site'],
      when: { kind: 'dietary' },
      rationale:
        'You listed dietary needs, so confirm them with whoever supplies the food.',
    },
    {
      id: 'task.confirm-volunteers',
      title: 'Confirm each volunteer and their role',
      timing: { kind: 'before', days: 5 },
      importance: 'critical',
      category: 'volunteers',
      dependsOn: ['task.volunteer-roster'],
      rationale: 'Last-minute dropouts are easier to cover with a few days left.',
    },
    {
      id: 'task.final-briefing',
      title: 'Brief the volunteers and walk the site',
      timing: { kind: 'before', days: 2 },
      importance: 'important',
      category: 'volunteers',
      dependsOn: ['task.confirm-volunteers', 'task.safety-plan'],
      rationale: 'A briefing makes sure everyone knows their role and the safety plan.',
    },
    {
      id: 'task.access-basics',
      title: 'Walk the site for basic access: entrances, routes and toilets',
      timing: { kind: 'before', days: 21 },
      importance: 'important',
      category: 'access',
      dependsOn: ['task.book-site'],
      when: { kind: 'not', of: { kind: 'accessibility' } },
      rationale:
        'Community events are open to the public, so check the basics even though no specific access needs were listed.',
    },
    {
      id: 'task.backup-plan',
      title: 'Line up backup volunteers, power and supplies',
      timing: { kind: 'before', days: 7 },
      importance: 'important',
      category: 'safety',
      dependsOn: ['task.volunteer-roster'],
      rationale:
        'Someone always drops out and something always runs short; name the backups before the day.',
    },
    {
      id: 'task.run-the-day',
      title: 'Run sign-in, stations and the volunteer rota',
      timing: { kind: 'on-day' },
      importance: 'critical',
      category: 'volunteers',
      dependsOn: ['task.final-briefing'],
      rationale:
        'A named lead keeps the rota and running order, and knows who to call when plans change.',
    },
    {
      id: 'task.cleanup',
      title: 'Clear the site, sort waste and pack hired equipment',
      timing: { kind: 'on-day' },
      importance: 'critical',
      category: 'wrap-up',
      dependsOn: ['task.final-briefing'],
      rationale:
        'Public sites usually must be left as found, and hired equipment has return deadlines.',
    },
    {
      id: 'task.thank-volunteers',
      title: 'Thank the volunteers',
      timing: { kind: 'after', days: 3 },
      importance: 'routine',
      category: 'wrap-up',
      dependsOn: ['task.final-briefing'],
      rationale: 'An explicit follow-up that happens after the event.',
    },
    {
      id: 'task.report-expenses',
      title: 'Report expenses and funding',
      timing: { kind: 'after', days: 7 },
      importance: 'important',
      category: 'wrap-up',
      dependsOn: ['task.final-briefing'],
      rationale:
        'An explicit follow-up: funders and members expect an account of the money.',
    },
  ],
  vendorChecklists: [
    {
      id: 'checklist.site',
      vendorKind: 'venue',
      title: 'Site questions',
      items: [
        {
          text: 'Confirm permission from the owner or authority, in writing, for {guests} people in {city}.',
        },
        { text: 'Ask about toilets, drinking water and power on site.' },
        { text: 'Ask what the site requires if the event runs late.' },
        {
          text: 'Ask for the covered or indoor alternative if the outdoor area cannot be used.',
          when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
        },
        {
          text: 'Walk the route a wheelchair user would take from entry to seating and restrooms.',
          when: {
            kind: 'accessibility',
            anyOf: ['wheelchair-access', 'step-free-route'],
          },
        },
      ],
    },
    {
      id: 'checklist.food',
      vendorKind: 'catering',
      title: 'Refreshment supplier questions',
      items: [
        { text: 'Ask for a price per head for {guests} guests.' },
        { text: 'Ask for the food safety certificate or licence.' },
        {
          text: 'Confirm items that suit the dietary needs you listed.',
          when: { kind: 'dietary' },
        },
      ],
    },
    {
      id: 'checklist.equipment',
      vendorKind: 'other',
      title: 'Equipment hire questions',
      items: [
        { text: 'Confirm delivery, set-up and collection times for {date}.' },
        { text: 'Ask what happens if you need more or fewer items near the date.' },
        {
          text: 'Ask whether wind or rain affects the hire terms.',
          when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
        },
      ],
    },
  ],
  ideaTags: [
    { tag: 'volunteer', label: 'Volunteers' },
    { tag: 'outreach', label: 'Outreach' },
    { tag: 'low-cost', label: 'Low cost' },
    { tag: 'safety', label: 'Safety' },
    { tag: 'sustainability', label: 'Sustainability' },
  ],
  ideas: [
    {
      id: 'idea.community-volunteer-badges',
      title: 'Volunteer badges and bibs',
      details:
        'Clear identification helps {guests} attendees find help quickly and costs little.',
      kind: 'favour',
      tags: ['volunteer', 'low-cost'],
      facets: {
        effort: 'low',
        leadDays: 7,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        priorities: ['guest-comfort'],
        costFrom: 'expense.volunteer-support',
        task: { title: 'Order volunteer badges or bibs', leadDays: 7 },
        why: 'Attendees can find help quickly.',
      },
    },
    {
      id: 'idea.community-bring-a-dish',
      title: 'Bring-a-dish contributions',
      details:
        'Neighbours bring a dish to share, which lowers the refreshment cost and builds ownership of the event.',
      kind: 'food',
      tags: ['low-cost', 'outreach'],
      facets: {
        effort: 'low',
        leadDays: 10,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        suitsDiets: ['vegetarian'],
        priorities: ['food', 'sustainability'],
        task: { title: 'Ask neighbours to sign up for a vegetarian dish', leadDays: 10 },
        why: 'Shared dishes lower refreshment costs and give people a stake in the event.',
      },
    },
    {
      id: 'idea.community-reusable-cups',
      title: 'Reusable cups and a refill point',
      details:
        'A water refill point and reusable cups cut waste and cost across {guests} attendees.',
      kind: 'favour',
      tags: ['sustainability', 'low-cost'],
      facets: {
        effort: 'medium',
        leadDays: 14,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        priorities: ['sustainability'],
        costFrom: 'expense.refreshments',
        task: {
          title: 'Borrow or rent reusable cups and set up a refill point',
          leadDays: 7,
        },
        why: 'It cuts waste and the cost of disposable cups.',
      },
    },
    {
      id: 'idea.community-shade-water',
      title: 'Shade and free drinking water',
      details:
        'The event is outdoors in {city}, so shade and free drinking water are a safety measure for everyone.',
      kind: 'decor',
      tags: ['safety'],
      facets: {
        effort: 'medium',
        leadDays: 7,
        budget: 'low',
        settings: ['outdoor'],
        helps: ['seating-areas'],
        priorities: ['guest-comfort', 'accessibility'],
        costFrom: 'expense.tents-chairs',
        task: { title: 'Arrange shade and drinking water points', leadDays: 5 },
        why: 'Shade and water keep an outdoor crowd safe and comfortable.',
      },
      when: { kind: 'setting', anyOf: ['outdoor', 'mixed'] },
    },
    {
      id: 'idea.community-welcome-desk',
      title: 'A welcome desk',
      details:
        'A staffed welcome desk gives newcomers a first point of contact and explains where things are.',
      kind: 'activity',
      tags: ['outreach', 'volunteer'],
      facets: {
        effort: 'low',
        leadDays: 5,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        helps: ['large-print'],
        priorities: ['guest-comfort'],
        costFrom: 'expense.signage-barriers',
        task: { title: 'Set up and staff a welcome desk', leadDays: 3 },
        why: 'Newcomers get a friendly first contact and clear information.',
      },
    },
    {
      id: 'idea.community-quiet-hour',
      title: 'A quieter hour',
      details:
        'You listed accessibility needs. A quieter hour with lower sound helps people who find crowds hard.',
      kind: 'activity',
      tags: ['outreach', 'safety'],
      facets: {
        effort: 'low',
        leadDays: 7,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        helps: ['quiet-space'],
        priorities: ['accessibility'],
        costFrom: 'expense.sound-system',
        task: { title: 'Agree a quieter hour with the sound team', leadDays: 3 },
        why: 'People who find noise hard can still take part.',
      },
      when: { kind: 'accessibility' },
    },
    {
      id: 'idea.community-skill-swap',
      title: 'A skill-swap corner',
      details:
        'Neighbours offer short demonstrations, from mending to cooking tips, at a table people can drop into.',
      kind: 'activity',
      tags: ['outreach'],
      facets: {
        effort: 'medium',
        leadDays: 14,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        priorities: ['entertainment'],
        task: {
          title: 'Invite three neighbours to run skill demonstrations',
          leadDays: 10,
        },
        why: 'It uses local talent and costs almost nothing.',
      },
    },
    {
      id: 'idea.community-clean-up-walk',
      title: 'A short clean-up walk',
      details:
        'A 30-minute group clean-up of the surrounding streets, with gloves and bags provided.',
      kind: 'activity',
      tags: ['sustainability', 'volunteer'],
      facets: {
        effort: 'medium',
        leadDays: 10,
        budget: 'low',
        settings: ['outdoor'],
        poorFor: ['step-free-route', 'wheelchair-access'],
        priorities: ['sustainability'],
        costFrom: 'expense.volunteer-support',
        task: { title: 'Arrange gloves, bags and a clean-up route', leadDays: 7 },
        why: 'It leaves the neighbourhood better than before the event.',
      },
    },
    {
      id: 'idea.community-sign-welcome',
      title: 'A short sign-language welcome',
      details:
        'The interpreter or a volunteer teaches everyone a few signs at the start, so Deaf neighbours feel included.',
      kind: 'activity',
      tags: ['outreach'],
      facets: {
        effort: 'low',
        leadDays: 7,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        helps: ['sign-language'],
        priorities: ['accessibility'],
        task: {
          title: 'Ask the interpreter or a volunteer to lead a sign-language welcome',
          leadDays: 5,
        },
        why: 'It makes inclusion visible from the first minute.',
      },
    },
    {
      id: 'idea.community-millet-snacks',
      title: 'Millet snacks and roasted chana',
      details:
        'Millet laddoos and roasted chana are cheap, filling and keep well outdoors.',
      kind: 'food',
      tags: ['low-cost'],
      facets: {
        effort: 'low',
        leadDays: 5,
        budget: 'low',
        settings: ['indoor', 'outdoor'],
        suitsDiets: ['vegetarian', 'vegan', 'jain', 'gluten-free', 'diabetic-friendly'],
        priorities: ['food'],
        costFrom: 'expense.refreshments',
        task: { title: 'Order millet snacks and roasted chana', leadDays: 3 },
        why: 'Low-cost food that suits many dietary needs.',
      },
    },
  ],
  culturalPractice: {
    leadDays: 21,
    taskRationale:
      'You listed this as a cultural preference. The planner does not add practices you did not ask for, so confirm with the community how it is usually done.',
    ideaDetails:
      'You listed this as a cultural preference. Ask the people who know it best how they would like it included.',
  },
};
