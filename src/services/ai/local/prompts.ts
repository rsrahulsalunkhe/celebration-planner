import type { ChatCompletionMessageParam, ResponseFormat } from '@mlc-ai/web-llm';
import { z } from 'zod';
import { formatDate } from '@/domain/dates.ts';
import type { ContextSnapshot } from '../assistant.ts';

/**
 * Prompts for the local model and checks on what it returns. The model only
 * ever sees the bounded snapshot and the user's message, and everything it
 * returns is treated as an untrusted draft: parsed, cleaned and checked
 * against the planner's own facts before it is shown.
 */

/** Hard cap on prompt text, well inside the engine's context window. */
export const MAX_PROMPT_CHARS = 3_500;

export const LIMITS = {
  ideas: { maxTokens: 450, temperature: 0.7 },
  invitation: { maxTokens: 260, temperature: 0.7 },
  explanation: { maxTokens: 320, temperature: 0.2 },
} as const;

export const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
const words = (list: readonly string[]) =>
  list.length === 0 ? 'none' : list.map((x) => x.replaceAll('-', ' ')).join(', ');

/** The event as plain facts. User-typed text (the title) is clipped and quoted. */
export function eventFacts(ctx: ContextSnapshot): string[] {
  const e = ctx.event;
  return [
    `Event type: ${e.eventType}. Title: "${clip(e.title, 80)}".`,
    `Date: ${formatDate(e.date)} (${e.daysUntil >= 0 ? `${e.daysUntil} days away` : 'already past'}). City: ${clip(e.city, 60)}. Setting: ${e.setting}.`,
    `Expected guests: ${e.guestCount}.${e.ageBand ? ` Age band of the guest of honour: ${e.ageBand}.` : ''}`,
    `Priorities: ${words(ctx.preferences.priorities)}.`,
    `Dietary needs: ${words(ctx.preferences.dietaryNeeds)}.`,
    `Accessibility needs: ${words(ctx.preferences.accessibilityNeeds)}.`,
    ctx.budget.hasBudget
      ? `Budget room: ${ctx.budget.headroomPaise >= 0 ? 'some money left after the reserve' : 'over plan already, so prefer low-cost ideas'}.`
      : 'Budget: not broken down yet.',
  ];
}

function bounded(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  let total = 0;
  return messages.map((m) => {
    const content = typeof m.content === 'string' ? m.content : '';
    const room = Math.max(200, MAX_PROMPT_CHARS - total);
    const cut = clip(content, room);
    total += cut.length;
    return { ...m, content: cut };
  });
}

// ---------------------------------------------------------------------------
// Ideas: JSON constrained by a schema, then validated again.
// ---------------------------------------------------------------------------

const ideasSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(80),
        details: z.string().trim().min(10).max(300),
      }),
    )
    .min(1)
    .max(6),
});

const IDEAS_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          details: { type: 'string' },
        },
        required: ['title', 'details'],
      },
    },
  },
  required: ['ideas'],
});

export function ideasPrompt(
  ctx: ContextSnapshot,
  message: string,
): { messages: ChatCompletionMessageParam[]; responseFormat: ResponseFormat } {
  return {
    messages: bounded([
      {
        role: 'system',
        content:
          'You suggest themes and activities for a celebration planner. Every idea must suit all of the event facts, especially dietary and accessibility needs. Do not mention prices, costs, totals, dates or deadlines. Keep each title short and each description to one or two sentences. Reply with JSON only.',
      },
      {
        role: 'user',
        content: `Event facts:\n${eventFacts(ctx).join('\n')}\n\nRequest: ${clip(message, 400)}\n\nGive 4 ideas as {"ideas":[{"title":"...","details":"..."}]}.`,
      },
    ]),
    responseFormat: { type: 'json_object', schema: IDEAS_JSON_SCHEMA },
  };
}

const MEAT =
  /\b(chicken|mutton|lamb|goat|beef|pork|bacon|ham|fish|prawns?|shrimp|crab|seafood|eggs?|omelette|kebab of meat|meat)\b/i;
const DAIRY =
  /\b(paneer|cheese|milk|ghee|butter|curd|yogh?urt|cream|kulfi|khoa|lassi|raita)\b/i;
const JAIN_EXCLUDED = /\b(onions?|garlic|potato(es)?|carrots?|beetroot|radish|ginger)\b/i;
const NUTS = /\b(nuts?|peanuts?|almonds?|cashews?|walnuts?|pistachios?|hazelnuts?)\b/i;
const MONEY = /₹|\brs\.?\s?\d|\brupees?\b|\binr\b/i;

const CONTROL = /[\p{Cc}\p{Cf}]/gu;
function cleanText(text: string, max: number): string {
  return clip(
    text
      .replace(CONTROL, ' ')
      .replace(/[*_#`>]+/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  );
}

export interface IdeasResult {
  items: { title: string; details: string }[];
  /** Ideas removed because they conflicted with stated needs or mentioned money. */
  removed: string[];
}

/** Parses and filters the model's ideas. Returns `null` if nothing usable came back. */
export function parseIdeas(raw: string, ctx: ContextSnapshot): IdeasResult | null {
  let json: unknown;
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    json = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch {
    return null;
  }
  const parsed = ideasSchema.safeParse(json);
  if (!parsed.success) return null;
  const diet = ctx.preferences.dietaryNeeds;
  const removed: string[] = [];
  const items = parsed.data.ideas.flatMap((idea) => {
    const title = cleanText(idea.title, 80);
    const details = cleanText(idea.details, 300);
    const text = `${title} ${details}`;
    const conflict =
      ((diet.includes('vegetarian') || diet.includes('vegan') || diet.includes('jain')) &&
        MEAT.test(text)) ||
      (diet.includes('vegan') && DAIRY.test(text)) ||
      (diet.includes('dairy-free') && DAIRY.test(text)) ||
      (diet.includes('jain') && JAIN_EXCLUDED.test(text)) ||
      (diet.includes('nut-allergy') && NUTS.test(text));
    if (conflict) {
      removed.push(`“${title}” conflicted with a stated dietary need.`);
      return [];
    }
    if (MONEY.test(text)) {
      removed.push(
        `“${title}” mentioned a price; costs come from the budget, not the assistant.`,
      );
      return [];
    }
    if (title.length < 3 || details.length < 10) return [];
    return [{ title, details }];
  });
  return items.length > 0 ? { items, removed } : null;
}

// ---------------------------------------------------------------------------
// Invitation wording: plain text, cleaned of anything the model invented.
// ---------------------------------------------------------------------------

export function invitationPrompt(
  ctx: ContextSnapshot,
  message: string,
): ChatCompletionMessageParam[] {
  return bounded([
    {
      role: 'system',
      content:
        'You write short, warm invitation wording for a celebration. Use only the details provided. Never invent names, addresses, phone numbers, email addresses, links, prices, times or RSVP deadlines; write [RSVP contact] and [RSVP date] where they are needed. Under 120 words. Plain text, no markdown.',
    },
    {
      role: 'user',
      content: `Event facts:\n${eventFacts(ctx).slice(0, 3).join('\n')}\n\nRequest: ${clip(message, 400)}`,
    },
  ]);
}

const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_LIKE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_LIKE = /(?:\+?\d[\d\s-]{8,}\d)/g;

export interface InvitationResult {
  text: string;
  warnings: string[];
}

export function cleanInvitation(
  raw: string,
  ctx: ContextSnapshot,
): InvitationResult | null {
  const warnings: string[] = [];
  let text = raw
    .replace(CONTROL, (c) => (c === '\n' ? '\n' : ' '))
    .replace(/[*_#`>]+/g, '');
  const replaced = (pattern: RegExp, label: string) => {
    const before = text;
    text = text.replace(pattern, label);
    return before !== text;
  };
  if (replaced(URL_LIKE, '[link]'))
    warnings.push('A link the model made up was replaced with [link].');
  if (replaced(EMAIL_LIKE, '[RSVP contact]'))
    warnings.push('An email address the model made up was replaced with [RSVP contact].');
  if (replaced(PHONE_LIKE, '[RSVP contact]'))
    warnings.push('A phone number the model made up was replaced with [RSVP contact].');
  if (MONEY.test(text))
    warnings.push('It mentions money; check that this is what you want.');
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length < 20) return null;
  text = clip(text, 1_200);
  const date = formatDate(ctx.event.date);
  const [day, month] = date.split(' ');
  if (!(day && month && text.includes(day) && text.includes(month))) {
    warnings.push(`It does not state the date (${date}); add it before sending.`);
  }
  return { text, warnings };
}

// ---------------------------------------------------------------------------
// Explanations: only from the planner's facts, and checked against them.
// ---------------------------------------------------------------------------

export function explanationPrompt(
  facts: readonly string[],
  message: string,
): ChatCompletionMessageParam[] {
  return bounded([
    {
      role: 'system',
      content:
        'You explain an event plan in plain, friendly words. Use only the FACTS given. Do not add or change any number, amount, percentage or date; repeat them exactly as written, or leave them out. If the facts do not answer the question, say so. Under 140 words. Plain text, no markdown.',
    },
    {
      role: 'user',
      content: `FACTS:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nQuestion: ${clip(message, 300)}`,
    },
  ]);
}

const AMOUNT =
  /₹\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]{1,}(?:\.\d+)?\b/g;
const DATE =
  /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?\b/g;
const normalise = (s: string) => s.replace(/[\s,₹]/g, '').replace(/\.0+(?=%|$)/, '');

/**
 * Every amount, percentage, multi-digit number and date in the explanation
 * must appear in the planner's facts. Returns the ones that do not.
 */
export function ungroundedFigures(
  explanation: string,
  facts: readonly string[],
): string[] {
  const factText = facts.join(' ');
  const known = new Set((factText.match(AMOUNT) ?? []).map(normalise));
  const knownDates = new Set(factText.match(DATE) ?? []);
  const unknown = [
    ...(explanation.match(AMOUNT) ?? []).filter((a) => !known.has(normalise(a))),
    ...(explanation.match(DATE) ?? []).filter(
      (d) => ![...knownDates].some((k) => k.startsWith(d) || d.startsWith(k)),
    ),
  ];
  return [...new Set(unknown.map((u) => u.trim()))];
}

export function cleanExplanation(raw: string): string | null {
  const text = raw
    .replace(CONTROL, (c) => (c === '\n' ? '\n' : ' '))
    .replace(/[*_#`>]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length < 20 ? null : clip(text, 1_200);
}
