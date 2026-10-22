import { formatDate } from '../dates.ts';
import { tryApplyOperations } from '../editEvent.ts';
import { formatMoney } from '../money.ts';
import type {
  Capability,
  ChangeOperation,
  EventRecord,
  EventType,
  ExpenseItem,
  IsoDate,
  Vendor,
  VendorKind,
} from '../types.ts';
import { accountingIssues } from './budget.ts';
import { matches, fillTokens } from './conditions.ts';
import { commitmentTotal } from './forecast.ts';
import type { PlanningConfiguration } from './types.ts';

/**
 * Vendor planning: a small bundled set of fictional sample vendors plus the
 * organizer's own records, matched against what the event actually needs.
 *
 * Nothing here contacts, verifies or books anyone. Capabilities in the sample
 * data are illustrative; the organizer confirms them. A capability that is
 * explicitly unavailable makes a vendor unsuitable; one that is not known
 * yet means "Needs confirmation", never a silent pass.
 */

export type PriceModel =
  | { basis: 'fixed'; amountPaise: number }
  | { basis: 'per-guest'; perGuestPaise: number; minimumPaise?: number };

export interface SampleVendor {
  /** Stable id, `sample.<slug>`. */
  id: string;
  kind: VendorKind;
  /** Fictional. */
  name: string;
  summary: string;
  /** Cities served. */
  serviceAreas: readonly string[];
  eventTypes: readonly EventType[];
  /** Guests they can serve, where that matters. */
  capacity?: { min?: number; max: number };
  /** Illustrative only; not a quote. */
  price: PriceModel;
  /** `true` can, `false` cannot; absent is not stated. */
  capabilities: Partial<Record<Capability, boolean>>;
  /** Questions specific to this vendor. */
  toConfirm: readonly string[];
}

export const VENDOR_KIND_LABELS: Record<VendorKind, string> = {
  venue: 'Venue',
  catering: 'Catering',
  photography: 'Photography',
  music: 'Music and sound',
  decor: 'Decor',
  transport: 'Transport',
  other: 'Equipment and other',
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  'wheelchair-access': 'Wheelchair access',
  'step-free-route': 'Step-free route',
  'accessible-restrooms': 'Accessible restrooms',
  'seating-areas': 'Extra seating areas',
  'sign-language': 'Sign language',
  'quiet-space': 'Quiet space',
  'large-print': 'Large-print materials',
  vegetarian: 'Vegetarian menu',
  vegan: 'Vegan menu',
  jain: 'Jain menu',
  halal: 'Halal menu',
  'gluten-free': 'Gluten-free options',
  'nut-allergy': 'Nut-allergy safe handling',
  'dairy-free': 'Dairy-free options',
  'diabetic-friendly': 'Diabetic-friendly options',
  'weather-cover': 'Covered or indoor alternative',
  'power-backup': 'Power backup',
};

/** Kinds where the number of guests decides whether a vendor can do the job at all. */
const CAPACITY_MATTERS: ReadonlySet<VendorKind> = new Set(['venue', 'catering']);

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export interface Requirement {
  capability: Capability;
  /** Why it is required, in plain words. */
  because: string;
}

export interface VendorRequirements {
  guestCount: number;
  city: string;
  eventType: EventType;
  /** Required capabilities for each kind of vendor. */
  byKind: Record<VendorKind, Requirement[]>;
}

const ACCESS_KINDS: Partial<Record<Capability, readonly VendorKind[]>> = {
  'wheelchair-access': ['venue', 'transport'],
  'step-free-route': ['venue'],
  'accessible-restrooms': ['venue'],
  'seating-areas': ['venue'],
  'quiet-space': ['venue'],
  'sign-language': ['venue'],
  'large-print': ['venue'],
};

/**
 * What vendors must be able to do, from the event's stated facts only:
 * accessibility needs for venues (and wheelchair access for transport),
 * dietary needs for caterers, a covered alternative for outdoor settings,
 * plus anything extra the organizer asks for.
 */
export function vendorRequirements(
  record: EventRecord,
  extra: readonly Capability[] = [],
): VendorRequirements {
  const { profile, preferences } = record;
  const byKind: Record<VendorKind, Requirement[]> = {
    venue: [],
    catering: [],
    photography: [],
    music: [],
    decor: [],
    transport: [],
    other: [],
  };
  const add = (kind: VendorKind, capability: Capability, because: string) => {
    if (!byKind[kind].some((r) => r.capability === capability)) {
      byKind[kind].push({ capability, because });
    }
  };
  for (const need of preferences.accessibilityNeeds) {
    for (const kind of ACCESS_KINDS[need] ?? ['venue']) {
      add(kind, need, 'You listed this accessibility need.');
    }
  }
  for (const need of preferences.dietaryNeeds) {
    add('catering', need, 'You listed this dietary need.');
  }
  if (profile.setting !== 'indoor') {
    const because = 'The event is at least partly outdoors.';
    add('venue', 'weather-cover', because);
    add('other', 'weather-cover', because);
  }
  for (const capability of extra) {
    for (const kind of Object.keys(byKind) as VendorKind[]) {
      add(kind, capability, 'You asked for this.');
    }
  }
  return {
    guestCount: profile.guestCount,
    city: profile.city,
    eventType: profile.eventType,
    byKind,
  };
}

// ---------------------------------------------------------------------------
// Candidates and matching
// ---------------------------------------------------------------------------

export interface Candidate {
  /** `sample:<id>` or `vendor:<id>`. */
  key: string;
  kind: VendorKind;
  name: string;
  /** Bundled fictional sample, or the organizer's own record. */
  source: 'sample' | 'user';
  sample: SampleVendor | null;
  /** The saved record when this candidate is on the event's list. */
  vendor: Vendor | null;
}

/**
 * Every sample vendor plus every saved vendor, each once. A shortlisted
 * sample appears with both its sample facts and its saved record.
 */
export function vendorCandidates(
  record: EventRecord,
  samples: readonly SampleVendor[],
): Candidate[] {
  const bySample = new Map(
    record.vendors.flatMap((v) => (v.sampleId ? [[v.sampleId, v] as const] : [])),
  );
  return [
    ...samples.map((s): Candidate => ({
      key: `sample:${s.id}`,
      kind: s.kind,
      name: s.name,
      source: 'sample',
      sample: s,
      vendor: bySample.get(s.id) ?? null,
    })),
    ...record.vendors
      .filter(
        (v) => v.sampleId === undefined || !samples.some((s) => s.id === v.sampleId),
      )
      .map((v): Candidate => ({
        key: `vendor:${v.id}`,
        kind: v.kind,
        name: v.name,
        source: 'user',
        sample: null,
        vendor: v,
      })),
  ];
}

export type MatchStatus = 'suitable' | 'needs-confirmation' | 'unsuitable';
export type CheckOutcome = 'met' | 'unknown' | 'failed';

export interface MatchCheck {
  criterion: 'event-type' | 'service-area' | 'capacity' | 'capability';
  outcome: CheckOutcome;
  text: string;
  capability?: Capability;
}

export interface VendorMatch {
  candidate: Candidate;
  status: MatchStatus;
  checks: MatchCheck[];
  /** Illustrative cost at the expected guest count, when a price is known. */
  estimatePaise: number | null;
  /** The budget target of the matching category, if the budget has one. */
  targetPaise: number | null;
  withinTarget: boolean | null;
  /** 1-based position among candidates that are not unsuitable. */
  rank: number | null;
  /** One plain sentence: why it matched, or why it is excluded. */
  summary: string;
}

export function estimateFor(price: PriceModel, guests: number): number {
  if (price.basis === 'fixed') return price.amountPaise;
  return Math.max(price.minimumPaise ?? 0, price.perGuestPaise * guests);
}

export function priceText(price: PriceModel): string {
  return price.basis === 'fixed'
    ? `${formatMoney(price.amountPaise)} fixed`
    : `${formatMoney(price.perGuestPaise)} per guest${price.minimumPaise ? `, minimum ${formatMoney(price.minimumPaise)}` : ''}`;
}

/** Budget category template that a vendor kind's cost belongs to, in order of preference. */
const CATEGORY_FOR_KIND: Record<VendorKind, readonly string[]> = {
  venue: ['category.venue'],
  catering: ['category.food'],
  photography: ['category.media'],
  music: ['category.entertainment'],
  decor: ['category.decor'],
  transport: ['category.transport'],
  other: ['category.equipment'],
};

export function budgetCategoryFor(record: EventRecord, kind: VendorKind): string | null {
  for (const templateId of CATEGORY_FOR_KIND[kind]) {
    const found = record.budgetCategories.find((c) => c.templateId === templateId);
    if (found) return found.id;
  }
  return null;
}

const sameCity = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('en-IN') === b.trim().toLocaleLowerCase('en-IN');

function checksFor(candidate: Candidate, req: VendorRequirements): MatchCheck[] {
  const { sample, vendor } = candidate;
  const checks: MatchCheck[] = [];

  if (sample) {
    checks.push(
      sample.eventTypes.includes(req.eventType)
        ? {
            criterion: 'event-type',
            outcome: 'met',
            text: `Works on ${req.eventType} events.`,
          }
        : {
            criterion: 'event-type',
            outcome: 'failed',
            text: `Does not take ${req.eventType} events (only ${sample.eventTypes.join(', ')}).`,
          },
    );
    checks.push(
      sample.serviceAreas.some((c) => sameCity(c, req.city))
        ? { criterion: 'service-area', outcome: 'met', text: `Serves ${req.city}.` }
        : {
            criterion: 'service-area',
            outcome: 'failed',
            text: `Serves ${sample.serviceAreas.join(', ')}, not ${req.city}.`,
          },
    );
  } else if (vendor?.serviceArea) {
    const listed = vendor.serviceArea
      .toLocaleLowerCase('en-IN')
      .includes(req.city.trim().toLocaleLowerCase('en-IN'));
    checks.push(
      listed
        ? {
            criterion: 'service-area',
            outcome: 'met',
            text: `You noted they serve ${req.city}.`,
          }
        : {
            criterion: 'service-area',
            outcome: 'unknown',
            text: `You noted “${vendor.serviceArea}”; confirm they serve ${req.city}.`,
          },
    );
  } else {
    checks.push({
      criterion: 'service-area',
      outcome: 'unknown',
      text: `Service area not recorded; confirm they serve ${req.city}.`,
    });
  }

  const capacity = vendor?.capacityMax
    ? { max: vendor.capacityMax }
    : (sample?.capacity ?? null);
  const guests = req.guestCount;
  if (capacity) {
    if (guests > capacity.max) {
      checks.push({
        criterion: 'capacity',
        outcome: 'failed',
        text: `Serves up to ${capacity.max} guests; you expect ${guests}.`,
      });
    } else if ('min' in capacity && capacity.min !== undefined && guests < capacity.min) {
      checks.push({
        criterion: 'capacity',
        outcome: 'failed',
        text: `Takes bookings from ${capacity.min} guests; you expect ${guests}.`,
      });
    } else {
      checks.push({
        criterion: 'capacity',
        outcome: 'met',
        text: `Serves up to ${capacity.max} guests; you expect ${guests}.`,
      });
    }
  } else if (CAPACITY_MATTERS.has(candidate.kind)) {
    checks.push({
      criterion: 'capacity',
      outcome: 'unknown',
      text: `Capacity not stated; confirm they can serve ${guests} guests.`,
    });
  }

  for (const requirement of req.byKind[candidate.kind]) {
    const label = CAPABILITY_LABELS[requirement.capability];
    // The organizer's own confirmation overrides the sample data.
    const confirmed = vendor?.capabilities?.[requirement.capability];
    const stated = confirmed ?? sample?.capabilities[requirement.capability];
    const source = confirmed === undefined ? 'Sample data says' : 'You recorded';
    checks.push(
      stated === true
        ? {
            criterion: 'capability',
            capability: requirement.capability,
            outcome: 'met',
            text: `${label}: ${confirmed === undefined ? 'listed in the sample data' : 'you confirmed it'}.`,
          }
        : stated === false
          ? {
              criterion: 'capability',
              capability: requirement.capability,
              outcome: 'failed',
              text: `${label}: ${source} they cannot provide it. ${requirement.because}`,
            }
          : {
              criterion: 'capability',
              capability: requirement.capability,
              outcome: 'unknown',
              text: `${label}: not known. ${requirement.because} Ask them to confirm.`,
            },
    );
  }
  return checks;
}

const STATUS_ORDER: Record<MatchStatus, number> = {
  suitable: 0,
  'needs-confirmation': 1,
  unsuitable: 2,
};

/**
 * Matches every candidate against the requirements and ranks the ones that
 * are not unsuitable by, in order: suitable before needs confirmation, fewer
 * unknowns, within the category's budget target, lower illustrative
 * estimate, then name. Each step is shown in the summary.
 */
export function matchVendors(
  record: EventRecord,
  candidates: readonly Candidate[],
  req: VendorRequirements,
): VendorMatch[] {
  const results = candidates.map((candidate): VendorMatch => {
    const checks = checksFor(candidate, req);
    const failed = checks.filter((c) => c.outcome === 'failed');
    const unknown = checks.filter((c) => c.outcome === 'unknown');
    const status: MatchStatus =
      failed.length > 0
        ? 'unsuitable'
        : unknown.length > 0
          ? 'needs-confirmation'
          : 'suitable';
    const estimatePaise = candidate.sample
      ? estimateFor(candidate.sample.price, req.guestCount)
      : (candidate.vendor?.quotePaise ?? null);
    const categoryId = budgetCategoryFor(record, candidate.kind);
    const targetPaise =
      categoryId === null
        ? null
        : (record.budgetCategories.find((c) => c.id === categoryId)?.plannedPaise ??
          null);
    const withinTarget =
      estimatePaise === null || targetPaise === null
        ? null
        : estimatePaise <= targetPaise;
    return {
      candidate,
      status,
      checks,
      estimatePaise,
      targetPaise,
      withinTarget,
      rank: null,
      summary:
        status === 'unsuitable' ? `Excluded: ${failed.map((c) => c.text).join(' ')}` : '',
    };
  });

  const unknownCount = (m: VendorMatch) =>
    m.checks.filter((c) => c.outcome === 'unknown').length;
  const targetOrder = (m: VendorMatch) =>
    m.withinTarget === true ? 0 : m.withinTarget === null ? 1 : 2;
  const ranked = results
    .filter((m) => m.status !== 'unsuitable')
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        unknownCount(a) - unknownCount(b) ||
        targetOrder(a) - targetOrder(b) ||
        (a.estimatePaise ?? Number.MAX_SAFE_INTEGER) -
          (b.estimatePaise ?? Number.MAX_SAFE_INTEGER) ||
        a.candidate.name.localeCompare(b.candidate.name),
    );

  // Rank within each kind, because vendors of different kinds do not compete.
  const position = new Map<VendorKind, number>();
  for (const m of ranked) {
    const rank = (position.get(m.candidate.kind) ?? 0) + 1;
    position.set(m.candidate.kind, rank);
    m.rank = rank;
    const met = m.checks.filter((c) => c.outcome === 'met').length;
    const unknown = unknownCount(m);
    const parts = [
      `Ranked ${rank} among ${VENDOR_KIND_LABELS[m.candidate.kind].toLowerCase()} options: meets ${met} of ${m.checks.length} checks`,
    ];
    if (unknown > 0) parts.push(`${unknown} still to confirm`);
    if (m.estimatePaise !== null) {
      const what = m.candidate.sample ? 'illustrative estimate' : 'your recorded quote';
      parts.push(
        m.targetPaise === null
          ? `${what} ${formatMoney(m.estimatePaise)}`
          : `${what} ${formatMoney(m.estimatePaise)} is ${m.withinTarget ? 'within' : 'above'} the ${formatMoney(m.targetPaise)} target`,
      );
    } else {
      parts.push('no price yet');
    }
    m.summary = `${parts.join('; ')}.`;
  }
  return results.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.rank ?? 0) - (b.rank ?? 0) ||
      a.candidate.name.localeCompare(b.candidate.name),
  );
}

// ---------------------------------------------------------------------------
// Organizer checklist
// ---------------------------------------------------------------------------

export interface ChecklistQuestion {
  id: string;
  text: string;
}

/**
 * Questions for the organizer to ask. Always: availability, quote scope,
 * accessibility, payment terms and cancellation terms; dietary capability
 * for caterers or when dietary needs are listed; then the plan's own
 * questions for this kind of vendor and the sample's specific ones. Ticking
 * them records what the organizer checked; nothing is verified here.
 */
export function vendorChecklist(
  record: EventRecord,
  kind: VendorKind,
  configuration: PlanningConfiguration,
  sample: SampleVendor | null,
): ChecklistQuestion[] {
  const { profile, preferences } = record;
  const ctx = { profile, preferences };
  const access =
    preferences.accessibilityNeeds.length > 0
      ? `Ask them to confirm in writing how they meet: ${preferences.accessibilityNeeds.map((n) => CAPABILITY_LABELS[n].toLowerCase()).join(', ')}.`
      : 'Ask how guests with limited mobility, hearing or sight are accommodated.';
  const questions: ChecklistQuestion[] = [
    {
      id: 'core.availability',
      text: `Confirm they are available on ${formatDate(profile.date)} for the times you need.`,
    },
    {
      id: 'core.quote-scope',
      text: `Get the quote in writing: what is included for ${profile.guestCount} guests, what costs extra, and whether taxes are included.`,
    },
    { id: 'core.accessibility', text: access },
  ];
  if (kind === 'catering' || preferences.dietaryNeeds.length > 0) {
    questions.push({
      id: 'core.dietary',
      text:
        preferences.dietaryNeeds.length > 0
          ? `Confirm they can provide ${preferences.dietaryNeeds.map((n) => CAPABILITY_LABELS[n].toLowerCase()).join(', ')}, and how dishes are kept separate.`
          : 'Ask which dietary needs they can cater for and how allergens are handled.',
    });
  }
  questions.push(
    {
      id: 'core.payment-terms',
      text: 'Agree the payment terms: deposit amount, when the balance is due and how to pay.',
    },
    {
      id: 'core.cancellation',
      text: 'Get the cancellation and refund terms in writing, for both sides.',
    },
  );
  const planLists = configuration.types[profile.eventType].vendorChecklists.filter(
    (list) => list.vendorKind === kind && matches(list.when, ctx),
  );
  for (const list of planLists) {
    list.items.forEach((item, index) => {
      if (matches(item.when, ctx)) {
        questions.push({ id: `${list.id}.${index}`, text: fillTokens(item.text, ctx) });
      }
    });
  }
  sample?.toConfirm.forEach((text, index) => {
    questions.push({ id: `sample.${index}`, text });
  });
  return questions;
}

// ---------------------------------------------------------------------------
// Shortlisting and the agreed quote
// ---------------------------------------------------------------------------

/** A saved record for a shortlisted sample. Only the name and kind are copied. */
export function shortlistSample(sample: SampleVendor, id: string): Vendor {
  return {
    id,
    name: sample.name,
    kind: sample.kind,
    status: 'shortlisted',
    quotePaise: null,
    sampleId: sample.id,
  };
}

export interface AgreedQuote {
  basis: 'fixed' | 'per-guest';
  /** Total for fixed, rate for per-guest. */
  amountPaise: number;
  /** The deposit as part of the agreement; never added to the cost. */
  depositPaise?: number;
  /** When the deposit has been paid, the date it was paid. */
  depositPaidOn?: IsoDate;
  /** The expense this quote covers, or `'new'` to create one. Ignored once one is linked. */
  expenseId: string;
  /** Category for a new expense. */
  categoryId: string;
  /** Id for a new expense (ids are created by the caller). */
  newExpenseId: string;
}

/** The one expense linked to a vendor, if any. */
export function linkedExpense(record: EventRecord, vendorId: string): ExpenseItem | null {
  return record.expenses.find((e) => e.vendorId === vendorId) ?? null;
}

/** Stable id for a vendor's deposit payment, so recording it again replaces it. */
export const depositPaymentId = (vendorId: string): string => `${vendorId}~deposit`;

export type QuoteEdit =
  | { ok: true; operations: ChangeOperation[]; expenseId: string; created: boolean }
  | { ok: false; issues: string[] };

/**
 * Records an agreed quote against exactly one expense:
 * - an expense already linked to the vendor is updated in place;
 * - otherwise the chosen expense is linked, or a new one is created.
 * The deposit is part of the agreed total. A paid deposit is one payment with
 * a stable id, so repeating the action replaces it instead of adding another.
 * This records what the organizer agreed; it does not book anything.
 */
export function agreedQuoteOperations(
  record: EventRecord,
  vendor: Vendor,
  quote: AgreedQuote,
): QuoteEdit {
  const issues: string[] = [];
  if (!Number.isSafeInteger(quote.amountPaise) || quote.amountPaise <= 0) {
    issues.push('Enter the agreed amount.');
  }
  const linked = linkedExpense(record, vendor.id);
  const chosen =
    linked ??
    (quote.expenseId === 'new'
      ? null
      : (record.expenses.find((e) => e.id === quote.expenseId) ?? null));
  if (!linked && quote.expenseId !== 'new' && !chosen) {
    issues.push('That expense no longer exists.');
  }
  if (chosen?.vendorId !== undefined && chosen.vendorId !== vendor.id) {
    issues.push('That expense is already linked to another vendor.');
  }
  const commitment: NonNullable<ExpenseItem['commitment']> =
    quote.basis === 'fixed'
      ? {
          basis: 'fixed',
          totalPaise: quote.amountPaise,
          ...(quote.depositPaise ? { depositPaise: quote.depositPaise } : {}),
        }
      : {
          basis: 'per-guest',
          perGuestPaise: quote.amountPaise,
          ...(quote.depositPaise ? { depositPaise: quote.depositPaise } : {}),
        };
  const total =
    issues.length === 0 ? commitmentTotal(commitment, record.profile.guestCount) : 0;
  if (
    quote.depositPaise !== undefined &&
    quote.depositPaise > total &&
    issues.length === 0
  ) {
    issues.push(
      `The deposit (${formatMoney(quote.depositPaise)}) cannot be more than the agreed total (${formatMoney(total)}).`,
    );
  }
  if (quote.depositPaidOn !== undefined && !quote.depositPaise) {
    issues.push('Enter the deposit amount before marking it paid.');
  }
  if (issues.length > 0) return { ok: false, issues };

  const depositId = depositPaymentId(vendor.id);
  const otherPayments = (chosen?.payments ?? []).filter((p) => p.id !== depositId);
  const payments =
    quote.depositPaidOn && quote.depositPaise
      ? [
          ...otherPayments,
          {
            id: depositId,
            amountPaise: quote.depositPaise,
            date: quote.depositPaidOn,
            note: 'Deposit',
          },
        ]
      : otherPayments;

  const expense: ExpenseItem = chosen
    ? { ...chosen, vendorId: vendor.id, commitment, payments }
    : {
        id: quote.newExpenseId,
        categoryId: quote.categoryId,
        vendorId: vendor.id,
        name: vendor.name,
        estimate:
          quote.basis === 'fixed'
            ? { basis: 'fixed', amountPaise: quote.amountPaise }
            : { basis: 'per-guest', perGuestPaise: quote.amountPaise },
        estimateOrigin: 'user',
        commitment,
        payments,
      };
  const accounting = accountingIssues(expense, record.profile.guestCount)[0];
  if (accounting) return { ok: false, issues: [accounting.message] };

  const operations: ChangeOperation[] = [
    { op: 'expenses/upsert', item: expense },
    // Keep the vendor's latest quote in step with the agreement's total.
    { op: 'vendors/upsert', item: { ...vendor, quotePaise: total } },
  ];
  const applied = tryApplyOperations(record, operations);
  if (!applied.ok) return applied;
  return { ok: true, operations, expenseId: expense.id, created: chosen === null };
}
