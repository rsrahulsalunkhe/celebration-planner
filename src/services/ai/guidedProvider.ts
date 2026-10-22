import { FOOD_IDEAS } from '@/data/assistantIdeas.ts';
import { DIETARY_LABELS, EVENT_TYPE_LABELS } from '@/data/labels.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatDate } from '@/domain/dates.ts';
import { formatMoney } from '@/domain/money.ts';
import { DIETARY_NEEDS, LIMITS, MAX_RESERVE_BASIS_POINTS } from '@/domain/primitives.ts';
import type { EventType, Setting } from '@/domain/types.ts';
import {
  MAX_MESSAGE_CHARS,
  changeIntentSchema,
  type AssistantProvider,
  type AssistantRequest,
  type AssistantResponse,
  type ChangeIntent,
  type ContextSnapshot,
  type ProviderInfo,
  type SuggestedReply,
} from './assistant.ts';

/**
 * A deterministic, rule-based assistant. It recognises a fixed set of
 * commands with regular expressions and answers from the context snapshot.
 * It is not a language model and does not pretend to understand free text:
 * anything it does not recognise gets the list of commands it does.
 *
 * It never guesses units. "Reduce the budget by 15" is answered with a
 * question (15% or ₹15?), never with a change.
 */

const INFO: ProviderInfo = { id: 'guided', label: 'Guided planner' };

export const GUIDED_EXAMPLES = [
  'What should I do next?',
  'Explain my budget.',
  'Reduce my budget by 15%.',
  'Set guests to 120.',
  'What changes if we move outdoors?',
  'Suggest vegetarian birthday ideas.',
  'Set the reserve to 12%.',
] as const;

type Answer = DistributiveOmit<
  AssistantResponse,
  'requestId' | 'eventId' | 'revision' | 'provider'
>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const pct = (bp: number) => `${(bp / 100).toString()}%`;
const money = (paise: number) =>
  paise < 0 ? `−${formatMoney(-paise)}` : formatMoney(paise);
const rupees = (n: number) => formatMoney(Math.round(n * 100));

// ---------------------------------------------------------------------------
// Amount parsing: only explicit units are accepted.
// ---------------------------------------------------------------------------

type Amount =
  | { kind: 'percent'; value: number }
  | { kind: 'rupees'; paise: number }
  | { kind: 'bare'; value: number }
  | { kind: 'vague'; text: string }
  | { kind: 'none' };

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;

function parseAmount(raw: string): Amount {
  const text = raw
    .trim()
    .replace(/[.?!]+$/, '')
    .trim();
  if (text === '') return { kind: 'none' };
  if (
    /\b(about|around|approx(?:imately)?|roughly|maybe|or|to|-|–)\b|\d\s*[-–]\s*\d/.test(
      text,
    )
  ) {
    return { kind: 'vague', text };
  }
  const num = (s: string) => Number(s.replace(/,/g, ''));
  let m = new RegExp(String.raw`^${NUMBER}\s*(%|percent|per cent)$`).exec(text);
  if (m?.[1]) return { kind: 'percent', value: num(m[1]) };
  m = new RegExp(String.raw`^(?:₹|rs\.?|inr|rupees?)\s*${NUMBER}$`).exec(text);
  if (m?.[1]) return { kind: 'rupees', paise: Math.round(num(m[1]) * 100) };
  m = new RegExp(String.raw`^${NUMBER}\s*(?:rupees?|rs\.?|inr)$`).exec(text);
  if (m?.[1]) return { kind: 'rupees', paise: Math.round(num(m[1]) * 100) };
  m = new RegExp(String.raw`^(?:₹\s*)?${NUMBER}\s*(?:lakhs?|lacs?)$`).exec(text);
  if (m?.[1]) return { kind: 'rupees', paise: Math.round(num(m[1]) * 100_000 * 100) };
  m = new RegExp(String.raw`^${NUMBER}$`).exec(text);
  if (m?.[1]) return { kind: 'bare', value: num(m[1]) };
  return { kind: 'vague', text };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Detected =
  | { kind: 'change'; label: string; intent: ChangeIntent }
  | { kind: 'answer'; answer: Answer };

function question(text: string, options: SuggestedReply[]): Answer {
  return { kind: 'question', text, options };
}

function proposal(intent: ChangeIntent, label: string): Detected {
  const checked = changeIntentSchema.safeParse(intent);
  if (!checked.success) {
    return {
      kind: 'answer',
      answer: info('I cannot propose that', [
        checked.error.issues[0]?.message ??
          'That value is outside what the planner accepts.',
      ]),
    };
  }
  return { kind: 'change', label, intent: checked.data };
}

function info(
  title: string,
  paragraphs: string[],
  extra: Partial<Extract<Answer, { kind: 'info' }>> = {},
): Answer {
  return { kind: 'info', title, paragraphs, ...extra };
}

function detectBudgetReduce(lower: string, ctx: ContextSnapshot): Detected | null {
  const m = /\b(?:reduce|cut|lower|decrease|trim)\b.*?\bbudget\b.*?\bby\s+(.+)$/.exec(
    lower,
  );
  if (!m?.[1]) return null;
  const amount = parseAmount(m[1]);
  const current = ctx.event.budgetPaise;
  if (amount.kind === 'percent') {
    if (!Number.isInteger(amount.value) || amount.value < 1 || amount.value > 99) {
      return {
        kind: 'answer',
        answer: question(
          `A budget cut must be a whole percentage from 1% to 99%. You wrote ${m[1].trim()}. Which cut do you want?`,
          [10, 15, 20].map((p) => ({
            label: `${p}%`,
            message: `Reduce my budget by ${p}%`,
          })),
        ),
      };
    }
    return proposal(
      { type: 'reduce-budget-percent', percent: amount.value },
      `reduce the budget by ${amount.value}%`,
    );
  }
  if (amount.kind === 'rupees') {
    if (amount.paise <= 0 || amount.paise >= current) {
      return {
        kind: 'answer',
        answer: question(
          `The budget is ${formatMoney(current)}, so a cut of ${formatMoney(amount.paise)} is not possible. How much should it go down by?`,
          [10, 15].map((p) => ({ label: `${p}%`, message: `Reduce my budget by ${p}%` })),
        ),
      };
    }
    return proposal(
      { type: 'set-budget', budgetPaise: current - amount.paise },
      `reduce the budget by ${formatMoney(amount.paise)}`,
    );
  }
  if (amount.kind === 'bare') {
    return {
      kind: 'answer',
      answer: question(
        `Did you mean ${amount.value}% or ${rupees(amount.value)}? I will not guess the unit.`,
        [
          { label: `${amount.value}%`, message: `Reduce my budget by ${amount.value}%` },
          {
            label: rupees(amount.value),
            message: `Reduce my budget by ₹${amount.value}`,
          },
        ],
      ),
    };
  }
  return {
    kind: 'answer',
    answer: question(
      'How much should the budget go down by? Give one exact amount with a unit, for example 15% or ₹20,000.',
      [{ label: '15%', message: 'Reduce my budget by 15%' }],
    ),
  };
}

function detectBudgetSet(lower: string): Detected | null {
  const m = /\b(?:set|change|make|update)\b.*?\bbudget\b.*?\bto\s+(.+)$/.exec(lower);
  if (!m?.[1]) return null;
  const amount = parseAmount(m[1]);
  if (amount.kind === 'rupees') {
    return proposal(
      { type: 'set-budget', budgetPaise: amount.paise },
      `set the budget to ${formatMoney(amount.paise)}`,
    );
  }
  if (amount.kind === 'bare') {
    return {
      kind: 'answer',
      answer: question(
        `Set the budget to ${rupees(amount.value)}? Please confirm the unit.`,
        [
          {
            label: `Yes, ${rupees(amount.value)}`,
            message: `Set the budget to ₹${amount.value}`,
          },
        ],
      ),
    };
  }
  return {
    kind: 'answer',
    answer: question(
      'What should the budget be? Give one amount in rupees, for example ₹4,50,000 or 4.5 lakh.',
      [],
    ),
  };
}

function detectGuests(lower: string, ctx: ContextSnapshot): Detected | null {
  const m =
    /\b(?:set|change|make|update)\b.*?\b(?:guests?|guest count|headcount|number of people)\b.*?\bto\s+(.+)$/.exec(
      lower,
    ) ?? /^(?:guests?|guest count|headcount)\s*(?:=|:|to)\s*(.+)$/.exec(lower);
  if (!m?.[1]) {
    if (/\b(?:increase|decrease|reduce|raise)\b.*\bguests?\b.*\bby\b/.test(lower)) {
      return {
        kind: 'answer',
        answer: info(
          'Try a what-if on the Budget page',
          [
            'Changing guests by a percentage is a what-if on the Budget page, where you can preview it. Here I can set an exact number, like “Set guests to 120”.',
          ],
          { links: [{ label: 'Open the Budget what-ifs', to: '/budget' }] },
        ),
      };
    }
    return null;
  }
  const text = m[1].replace(/\s*(guests?|people)\s*[.?!]*$/, '');
  const amount = parseAmount(text);
  if (amount.kind === 'bare' && Number.isInteger(amount.value)) {
    if (amount.value < 1 || amount.value > LIMITS.guestCount) {
      return {
        kind: 'answer',
        answer: question(
          `The expected guest count must be from 1 to ${LIMITS.guestCount}. How many guests do you expect?`,
          [],
        ),
      };
    }
    if (amount.value === ctx.event.guestCount) {
      return {
        kind: 'answer',
        answer: info('Nothing to change', [
          `Expected guests is already ${amount.value}.`,
        ]),
      };
    }
    return proposal(
      { type: 'set-guest-count', guestCount: amount.value },
      `set guests to ${amount.value}`,
    );
  }
  const whole = amount.kind === 'bare' ? Math.round(amount.value) : null;
  return {
    kind: 'answer',
    answer: question(
      'How many guests exactly? The forecast needs one whole number.',
      whole !== null && whole >= 1
        ? [{ label: String(whole), message: `Set guests to ${whole}` }]
        : [],
    ),
  };
}

function detectReserve(lower: string): Detected | null {
  const m = /\breserve\b.*?\bto\s+(.+)$/.exec(lower);
  if (!m?.[1]) return null;
  const amount = parseAmount(m[1]);
  if (amount.kind === 'percent') {
    const bp = Math.round(amount.value * 100);
    if (
      Math.abs(amount.value * 100 - bp) > 1e-9 ||
      bp < 0 ||
      bp > MAX_RESERVE_BASIS_POINTS
    ) {
      return {
        kind: 'answer',
        answer: question(
          `The reserve must be from 0% to ${pct(MAX_RESERVE_BASIS_POINTS)}, with at most two decimals. What should it be?`,
          [{ label: '10%', message: 'Set the reserve to 10%' }],
        ),
      };
    }
    return proposal(
      { type: 'set-reserve', reserveBasisPoints: bp },
      `set the reserve to ${pct(bp)}`,
    );
  }
  if (amount.kind === 'bare') {
    return {
      kind: 'answer',
      answer: question(
        `The reserve is a percentage of the budget. Did you mean ${amount.value}%?`,
        [{ label: `${amount.value}%`, message: `Set the reserve to ${amount.value}%` }],
      ),
    };
  }
  return {
    kind: 'answer',
    answer: question('What percentage of the budget should the reserve be?', []),
  };
}

function detectSetting(lower: string, ctx: ContextSnapshot): Detected | null {
  if (!/\b(?:move|moving|switch|change|go|hold it|have it)\b/.test(lower)) return null;
  const wants: Setting[] = [];
  if (/\b(?:indoor and outdoor|inside and outside|mixed|both)\b/.test(lower))
    wants.push('mixed');
  else {
    if (/\b(?:outdoors?|outside)\b/.test(lower)) wants.push('outdoor');
    if (/\b(?:indoors?|inside)\b/.test(lower)) wants.push('indoor');
  }
  if (wants.length === 0) return null;
  if (wants.length > 1) {
    return {
      kind: 'answer',
      answer: question('Should the event be indoors, outdoors, or both?', [
        { label: 'Indoors', message: 'What changes if we move indoors?' },
        { label: 'Outdoors', message: 'What changes if we move outdoors?' },
        { label: 'Both', message: 'What changes if we move to indoor and outdoor?' },
      ]),
    };
  }
  const setting = wants[0] ?? 'indoor';
  if (setting === ctx.event.setting) {
    return {
      kind: 'answer',
      answer: info('Nothing to change', [`The event is already set as ${setting}.`]),
    };
  }
  return proposal({ type: 'set-setting', setting }, `change the setting to ${setting}`);
}

const UNSUPPORTED: {
  test: RegExp;
  title: string;
  text: string;
  link: { label: string; to: string };
}[] = [
  {
    test: /<\s*script|javascript:|\beval\b|\brun (?:this |some )?code\b|\bexecute\b/,
    title: 'I cannot run code',
    text: 'The guided planner only answers the commands listed below. It never runs code or scripts.',
    link: { label: 'Open the Overview', to: '/' },
  },
  {
    test: /\b(?:delete|remove)\b.*\bevent\b/,
    title: 'Deleting an event is done by you',
    text: 'I cannot delete events. Use Delete on the Overview, which asks you to confirm first.',
    link: { label: 'Open the Overview', to: '/' },
  },
  {
    test: /\b(?:pay|paid|payments?|deposits?)\b/,
    title: 'Payments are recorded by you',
    text: 'I cannot record or change payments. Record them on the Budget page under Expenses, or with an agreed quote on the Vendors page.',
    link: { label: 'Open the Budget', to: '/budget' },
  },
  {
    test: /\bbook(?:ed|ing)?\b|\bvendors?\b|\bcaterers?\b|\bphotographers?\b/,
    title: 'Vendors are managed on the Vendors page',
    text: 'I cannot contact, book or mark vendors as booked. Shortlist, compare and record what you agreed on the Vendors page.',
    link: { label: 'Open Vendors', to: '/vendors' },
  },
  {
    test: /\b(?:add|create|new)\b.*\btasks?\b|\bremind(?:er)?\b|\bto-?do\b/,
    title: 'Add tasks on the Timeline',
    text: 'I cannot add tasks or reminders. Use “Add your own task” on the Timeline.',
    link: { label: 'Open the Timeline', to: '/timeline' },
  },
  {
    test: /\b(?:invite|rsvp)\b|\badd\b.*\bguests?\b/,
    title: 'Guests are listed on the Overview',
    text: 'I cannot add guests or send invitations. List guests and replies in the Guests panel on the Overview.',
    link: { label: 'Open the Overview', to: '/' },
  },
  {
    test: /\b(?:date|reschedule|postpone|bring forward)\b/,
    title: 'Change the date with Edit event',
    text: 'I cannot change the date. Use Edit event on the Overview; the timeline is recalculated when you save.',
    link: { label: 'Open the Overview', to: '/' },
  },
];

// ---------------------------------------------------------------------------
// Informational answers
// ---------------------------------------------------------------------------

function nextSteps(ctx: ContextSnapshot): Answer {
  const paragraphs: string[] = [];
  const links: { label: string; to: string }[] = [];
  if (ctx.event.daysUntil < 0) {
    paragraphs.push(
      `${ctx.event.title} was on ${formatDate(ctx.event.date)}. What is left is follow-up: thank-you messages, settling balances and noting what to repeat.`,
    );
  }
  if (!ctx.timeline.hasTimeline) {
    paragraphs.push(
      'There is no timeline yet. Create one from the plan to get dated steps.',
    );
    links.push({ label: 'Open the Timeline', to: '/timeline' });
  } else if (ctx.timeline.next.length === 0) {
    paragraphs.push('Every task on the timeline is done.');
  } else {
    paragraphs.push(
      `${ctx.timeline.open} tasks are open${ctx.timeline.overdue > 0 ? `, ${ctx.timeline.overdue} overdue` : ''}. The most pressing:`,
    );
    for (const t of ctx.timeline.next) {
      paragraphs.push(
        `• ${t.title}: due ${formatDate(t.dueDate)} (${t.urgency.replace('-', ' ')})${t.blockedBy.length > 0 ? `; first finish ${t.blockedBy.join(' and ')}` : ''}.`,
      );
    }
    links.push({ label: 'Open the Timeline', to: '/timeline' });
  }
  if (!ctx.budget.hasBudget) {
    paragraphs.push(
      'There is no budget yet. Create a starting budget to see forecast costs.',
    );
    links.push({ label: 'Open the Budget', to: '/budget' });
  }
  for (const c of ctx.concerns) paragraphs.push(`Watch: ${c}`);
  return info('What to do next', paragraphs, { links });
}

function explainBudget(ctx: ContextSnapshot): Answer {
  const b = ctx.budget;
  if (!b.hasBudget) {
    return info(
      'There is no budget breakdown yet',
      [
        `The total budget is ${formatMoney(ctx.event.budgetPaise)}, with ${formatMoney(b.reservePaise)} held back as a ${pct(ctx.event.reserveBasisPoints)} reserve. Create a starting budget to see categories and forecast costs.`,
      ],
      { links: [{ label: 'Open the Budget', to: '/budget' }] },
    );
  }
  const paragraphs = [
    `Headroom = budget ${formatMoney(ctx.event.budgetPaise)} − reserve ${formatMoney(b.reservePaise)} − forecast ${formatMoney(b.forecastPaise)} = ${money(b.headroomPaise)}.`,
    `The forecast counts each item's agreed amount where there is one (${formatMoney(b.committedPaise)} agreed so far) and its estimate otherwise. ${formatMoney(b.paidPaise)} is paid and ${formatMoney(b.outstandingPaise)} is still owed on agreements; payments are part of the agreed amounts, not extra.`,
    `${formatMoney(b.fixedPaise)} is fixed and ${formatMoney(b.perGuestPaise)} per guest × ${ctx.event.guestCount} guests, so each guest more or less moves the forecast by ${formatMoney(b.perGuestPaise)}.`,
  ];
  if (b.shortfallPaise > 0) {
    paragraphs.push(
      `The forecast is ${formatMoney(b.shortfallPaise)} over the whole budget.`,
    );
  } else if (b.gapPaise > 0) {
    paragraphs.push(`The forecast uses ${formatMoney(b.gapPaise)} of the reserve.`);
  }
  for (const c of b.categories) {
    paragraphs.push(
      `• ${c.name}: forecast ${formatMoney(c.forecastPaise)} against a ${formatMoney(c.targetPaise)} target.`,
    );
  }
  for (const c of ctx.concerns) paragraphs.push(`Watch: ${c}`);
  return info('Your budget', paragraphs, {
    facts: [
      { label: 'Budget', value: formatMoney(ctx.event.budgetPaise) },
      {
        label: `Reserve (${pct(ctx.event.reserveBasisPoints)})`,
        value: formatMoney(b.reservePaise),
      },
      { label: 'Forecast', value: formatMoney(b.forecastPaise) },
      { label: 'Headroom', value: money(b.headroomPaise) },
    ],
    links: [{ label: 'Open the Budget', to: '/budget' }],
  });
}

const EVENT_WORDS: Record<EventType, RegExp> = {
  wedding: /\bweddings?\b|\bmarriage\b/,
  birthday: /\bbirthdays?\b|\bbday\b/,
  community: /\bcommunity\b|\bneighbou?rhood\b/,
};

function ideas(lower: string, ctx: ContextSnapshot): Answer {
  const asked = (Object.keys(EVENT_WORDS) as EventType[]).filter((t) =>
    EVENT_WORDS[t].test(lower),
  );
  const type = ctx.event.eventType;
  if (asked.length > 0 && !asked.includes(type)) {
    const cleaned = lower.replace(
      EVENT_WORDS[asked[0] ?? type],
      EVENT_TYPE_LABELS[type].toLowerCase(),
    );
    return question(
      `This event is a ${EVENT_TYPE_LABELS[type].toLowerCase()}, but you asked about ${asked.join(' and ')} ideas. Ideas for this event?`,
      [
        {
          label: `Yes, ${EVENT_TYPE_LABELS[type].toLowerCase()} ideas`,
          message: cleaned,
        },
      ],
    );
  }
  const diets = DIETARY_NEEDS.filter((d) =>
    new RegExp(`\\b${d.replace('-', '[- ]?')}\\b`).test(lower),
  );
  const config = PLANNING_CONFIGURATION.types[type];
  const fill = (text: string) =>
    text
      .replaceAll('{guests}', String(ctx.event.guestCount))
      .replaceAll('{city}', ctx.event.city)
      .replaceAll('{date}', formatDate(ctx.event.date));
  const food = FOOD_IDEAS.filter(
    (f) => f.eventTypes.includes(type) && diets.every((d) => f.suits.includes(d)),
  ).slice(0, 4);
  const general = diets.length > 0 ? [] : config.ideas.slice(0, 3);
  const items = [
    ...food.map((f) => ({ title: f.title, details: f.details })),
    ...general.map((i) => ({ title: i.title, details: fill(i.details) })),
  ];
  const listed = ctx.preferences.dietaryNeeds.filter((d) => !diets.includes(d));
  const dietWords = diets.map((d) => DIETARY_LABELS[d].toLowerCase());
  if (items.length === 0) {
    return info('No ideas match that', [
      `The guided planner's built-in list has nothing that suits ${dietWords.join(' and ')} for a ${EVENT_TYPE_LABELS[type].toLowerCase()}. Try fewer requirements.`,
    ]);
  }
  return {
    kind: 'draft',
    title:
      `${dietWords.length > 0 ? `${dietWords.join(' and ')} ` : ''}${EVENT_TYPE_LABELS[type].toLowerCase()} ideas`.replace(
        /^./,
        (c) => c.toUpperCase(),
      ),
    intro: `For ${ctx.event.guestCount} guests in ${ctx.event.city}${ctx.event.ageBand ? `, guest of honour aged ${ctx.event.ageBand.replace('-', ' to ')}` : ''}.`,
    items,
    note: `A draft from the guided planner's built-in idea list, not saved anywhere. Check every dish with whoever cooks it.${listed.length > 0 ? ` Your event also lists ${listed.map((d) => DIETARY_LABELS[d].toLowerCase()).join(', ')}.` : ''}`,
  };
}

function help(): Answer {
  return info(
    'What the guided planner can do',
    [
      'I follow a fixed set of commands and answer from your event’s details. I am not a language model, so I do not understand open-ended requests.',
      'Changes are only proposed: you see the planner’s calculation first, and nothing changes until you press Apply change.',
    ],
    { suggestions: GUIDED_EXAMPLES.map((e) => ({ label: e, message: e })) },
  );
}

/** The deterministic answer for one message. Exported for tests. */
export function guidedAnswer(message: string, ctx: ContextSnapshot): Answer {
  const lower = message.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (lower === '') return help();
  if (lower.length > MAX_MESSAGE_CHARS) {
    return info('That message is too long', [
      `Please keep messages under ${MAX_MESSAGE_CHARS} characters, one request at a time.`,
    ]);
  }
  if (/^(?:help|\?|what can you do\??|commands|examples)$/.test(lower)) return help();

  // Changes first, so "reduce my budget" is not read as "explain my budget".
  const detectAll = (text: string) =>
    [
      detectBudgetReduce(text, ctx),
      detectBudgetSet(text),
      detectGuests(text, ctx),
      detectReserve(text),
      detectSetting(text, ctx),
    ].filter((d): d is Detected => d !== null);

  // Several commands in one message are answered with a question, one per clause.
  const clauses = lower
    .split(/\s*(?:;|,|\bthen\b|\band\b)\s*/)
    .filter((c) => c.length > 0);
  const commands = clauses.flatMap((clause) => {
    const [d] = detectAll(clause);
    return d ? [{ clause, d }] : [];
  });
  if (commands.length > 1) {
    const cap = (t: string) => t.replace(/^./, (ch) => ch.toUpperCase());
    return question(
      'That asks for more than one change. I propose one change at a time so each can be checked. Which first?',
      commands.map(({ clause, d }) => {
        const text = cap(d.kind === 'change' ? d.label : clause);
        return { label: text, message: text };
      }),
    );
  }
  const detected = detectAll(lower);
  const [first] = detected;
  if (first) {
    if (first.kind === 'answer') return first.answer;
    return {
      kind: 'proposal',
      title: first.label.replace(/^./, (ch) => ch.toUpperCase()),
      explanation:
        'Below is the planner’s calculation for this change on your event as it is now. Nothing changes until you press Apply change.',
      intent: first.intent,
    };
  }

  for (const rule of UNSUPPORTED) {
    if (rule.test.test(lower)) {
      return info(rule.title, [rule.text], { links: [rule.link] });
    }
  }
  if (
    /\b(?:what (?:should|do|can) (?:i|we) do( next)?|next steps?|what(?:'s| is) next|what now|where (?:do|should) (?:i|we) start)\b/.test(
      lower,
    )
  ) {
    return nextSteps(ctx);
  }
  if (/\bbudget\b/.test(lower)) return explainBudget(ctx);
  if (/\bideas?\b|\bsuggest/.test(lower)) return ideas(lower, ctx);

  return info(
    'I did not recognise that',
    [
      'The guided planner understands a fixed set of commands, not free conversation. Try one of these, or use the forms on each page.',
    ],
    { suggestions: GUIDED_EXAMPLES.map((e) => ({ label: e, message: e })) },
  );
}

export const guidedPlannerProvider: AssistantProvider = {
  info: INFO,
  examples: GUIDED_EXAMPLES,
  respond(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
    if (signal?.aborted)
      return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    const answer = guidedAnswer(request.message, request.context);
    return Promise.resolve({
      ...answer,
      requestId: request.requestId,
      eventId: request.eventId,
      revision: request.revision,
      provider: INFO,
    });
  },
};
