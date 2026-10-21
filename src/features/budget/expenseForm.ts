import { formatMoney, formatMoneyInput, parseMoney } from '@/domain/money.ts';
import { accountingIssues } from '@/domain/planning/budget.ts';
import { commitmentTotal, estimateTotal, paidTotal } from '@/domain/planning/forecast.ts';
import { CURRENCY, MAX_RESERVE_BASIS_POINTS } from '@/domain/primitives.ts';
import { expenseItemSchema, paymentSchema } from '@/domain/schemas.ts';
import type { ExpenseItem, Payment, Preferences } from '@/domain/types.ts';

/**
 * Form state is text, so a blank box stays blank and is never read as zero.
 * Amounts become integer paise only when the form is submitted; a formatted
 * string such as "₹1,25,000" is never stored.
 */
export type Basis = 'fixed' | 'per-guest';
export type CommitmentChoice = 'none' | Basis;

export interface ExpenseFormValues {
  name: string;
  categoryId: string;
  estimateBasis: Basis;
  estimateAmount: string;
  commitmentBasis: CommitmentChoice;
  commitmentAmount: string;
  notes: string;
}

export type ExpenseField = keyof ExpenseFormValues;
export type ExpenseFormErrors = Partial<Record<ExpenseField, string>>;

/** Order used to focus the first problem. */
export const EXPENSE_FIELD_ORDER: readonly ExpenseField[] = [
  'name',
  'categoryId',
  'estimateBasis',
  'estimateAmount',
  'commitmentBasis',
  'commitmentAmount',
  'notes',
];

export function valuesFromExpense(
  expense: ExpenseItem | null,
  defaultCategoryId: string,
): ExpenseFormValues {
  if (!expense) {
    return {
      name: '',
      categoryId: defaultCategoryId,
      estimateBasis: 'fixed',
      estimateAmount: '',
      commitmentBasis: 'none',
      commitmentAmount: '',
      notes: '',
    };
  }
  const { estimate, commitment } = expense;
  return {
    name: expense.name,
    categoryId: expense.categoryId,
    estimateBasis: estimate.basis,
    estimateAmount: formatMoneyInput(
      estimate.basis === 'fixed' ? estimate.amountPaise : estimate.perGuestPaise,
    ),
    commitmentBasis: commitment?.basis ?? 'none',
    commitmentAmount: commitment
      ? formatMoneyInput(
          commitment.basis === 'fixed' ? commitment.totalPaise : commitment.perGuestPaise,
        )
      : '',
    notes: expense.notes ?? '',
  };
}

/** Rupees text to paise, with a message for blank or malformed input. */
export function readAmount(
  text: string,
  example: string,
): { paise: number } | { error: string } {
  if (text.trim() === '') return { error: `Enter an amount in rupees, like ${example}` };
  const paise = parseMoney(text, CURRENCY);
  if (paise === null) {
    return {
      error: `Enter rupees as digits, like ${example} or 1250.50. No minus sign or letters.`,
    };
  }
  return { paise };
}

/** `12.5` → 1250 basis points. Up to two decimals, 0 to the maximum reserve. */
export function readPercent(text: string): { basisPoints: number } | { error: string } {
  const cleaned = text.trim().replace(/%$/, '').trim();
  if (cleaned === '') return { error: 'Enter a percentage, like 10' };
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { error: 'Enter a percentage as a number, like 10 or 12.5' };
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (basisPoints > MAX_RESERVE_BASIS_POINTS) {
    return { error: `The reserve can be at most ${MAX_RESERVE_BASIS_POINTS / 100}%` };
  }
  return { basisPoints };
}

const stillRequired = (preferences: Preferences, requirement: string): boolean =>
  requirement === 'dietary'
    ? preferences.dietaryNeeds.length > 0
    : preferences.accessibilityNeeds.some((need) => need === requirement);

export interface ExpenseContext {
  /** The expense being edited, or `null` when adding. */
  existing: ExpenseItem | null;
  /** Id for a new expense (ids are created by the caller, because that is not pure). */
  newId: string;
  guestCount: number;
  preferences: Preferences;
}

export type ExpenseParse =
  { ok: true; expense: ExpenseItem } | { ok: false; errors: ExpenseFormErrors };

/**
 * Validates the form against the accounting model: an agreement replaces the
 * estimate in the forecast, payments need an agreement and must fit inside
 * it, and a required provision cannot be priced at zero.
 */
export function parseExpenseForm(
  values: ExpenseFormValues,
  context: ExpenseContext,
): ExpenseParse {
  const { existing, guestCount, preferences } = context;
  const errors: ExpenseFormErrors = {};

  const estimateRead = readAmount(
    values.estimateAmount,
    values.estimateBasis === 'fixed' ? '25000' : '650',
  );
  if ('error' in estimateRead) errors.estimateAmount = estimateRead.error;
  const estimate: ExpenseItem['estimate'] | null =
    'error' in estimateRead
      ? null
      : values.estimateBasis === 'fixed'
        ? { basis: 'fixed', amountPaise: estimateRead.paise }
        : { basis: 'per-guest', perGuestPaise: estimateRead.paise };

  let commitment: ExpenseItem['commitment'] = null;
  if (values.commitmentBasis !== 'none') {
    const read = readAmount(
      values.commitmentAmount,
      values.commitmentBasis === 'fixed' ? '25000' : '650',
    );
    if ('error' in read) {
      errors.commitmentAmount = read.error;
    } else {
      // A recorded deposit stays with an agreement of the same kind.
      const deposit =
        existing?.commitment?.basis === values.commitmentBasis
          ? existing.commitment.depositPaise
          : undefined;
      commitment =
        values.commitmentBasis === 'fixed'
          ? {
              basis: 'fixed',
              totalPaise: read.paise,
              ...(deposit !== undefined ? { depositPaise: deposit } : {}),
            }
          : {
              basis: 'per-guest',
              perGuestPaise: read.paise,
              ...(deposit !== undefined ? { depositPaise: deposit } : {}),
            };
      if (commitment.basis === 'fixed' && deposit !== undefined && deposit > read.paise) {
        errors.commitmentAmount = `The agreed total cannot be less than the recorded deposit of ${formatMoney(deposit)}.`;
      }
    }
  }

  const payments = existing?.payments ?? [];
  if (payments.length > 0 && values.commitmentBasis === 'none') {
    errors.commitmentBasis = `${formatMoney(paidTotal({ payments }))} is recorded as paid against this agreement. Remove those payments before clearing it.`;
  } else if (commitment && !errors.commitmentAmount) {
    const issue = accountingIssues({ commitment, payments }, guestCount)[0];
    if (issue) errors.commitmentAmount = issue.message;
  }

  if (existing?.requirement && stillRequired(preferences, existing.requirement)) {
    const cost = commitment
      ? commitmentTotal(commitment, guestCount)
      : estimate
        ? estimateTotal(estimate, guestCount)
        : null;
    if (cost === 0) {
      const field = commitment ? 'commitmentAmount' : 'estimateAmount';
      errors[field] ??=
        'This item meets a need you stated, so it cannot be priced at zero. Remove the need from the event first if it no longer applies.';
    }
  }

  if (!estimate || Object.keys(errors).length > 0) {
    return { ok: false, errors: withSchemaErrors(values, errors, null) };
  }

  const sameEstimate =
    existing !== null &&
    existing.estimate.basis === estimate.basis &&
    estimateTotal(existing.estimate, 1) === estimateTotal(estimate, 1);
  const notes = values.notes.trim();
  const { notes: _oldNotes, ...kept } = existing ?? {};
  const candidate: ExpenseItem = {
    ...kept,
    id: existing?.id ?? context.newId,
    categoryId: values.categoryId,
    name: values.name,
    estimate,
    // An estimate the user changes is theirs; an untouched one keeps its origin.
    estimateOrigin: sameEstimate ? existing.estimateOrigin : 'user',
    commitment,
    payments,
    ...(notes ? { notes } : {}),
  };
  const parsed = expenseItemSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: withSchemaErrors(values, errors, parsed.error.issues) };
  }
  return { ok: true, expense: parsed.data };
}

function withSchemaErrors(
  values: ExpenseFormValues,
  errors: ExpenseFormErrors,
  issues: readonly { path: PropertyKey[]; message: string }[] | null,
): ExpenseFormErrors {
  const out = { ...errors };
  if (values.categoryId === '') out.categoryId ??= 'Choose a category';
  const nameIssue = expenseItemSchema.shape.name.safeParse(values.name);
  if (!nameIssue.success) out.name ??= nameIssue.error.issues[0]?.message;
  for (const issue of issues ?? []) {
    const head = issue.path[0];
    if (head === 'name') out.name ??= issue.message;
    else if (head === 'notes') out.notes ??= issue.message;
    else if (head === 'commitment') out.commitmentAmount ??= issue.message;
    else if (head === 'estimate') out.estimateAmount ??= issue.message;
    else out.name ??= issue.message;
  }
  return out;
}

export interface PaymentFormValues {
  amount: string;
  date: string;
}

export type PaymentParse =
  | { ok: true; payment: Payment }
  | { ok: false; errors: Partial<Record<keyof PaymentFormValues, string>> };

/** A payment must fit inside the saved agreement, as must every payment before it. */
export function parsePaymentForm(
  values: PaymentFormValues,
  expense: ExpenseItem,
  guestCount: number,
  id: string,
): PaymentParse {
  if (!expense.commitment) {
    return {
      ok: false,
      errors: {
        amount: 'Payments are part of an agreed amount. Save the agreed total first.',
      },
    };
  }
  const errors: Partial<Record<keyof PaymentFormValues, string>> = {};
  const read = readAmount(values.amount, '10000');
  if ('error' in read) errors.amount = read.error;
  else if (read.paise === 0) errors.amount = 'A payment must be more than zero';
  if (values.date.trim() === '') errors.date = 'Enter the date it was paid';

  if (!('error' in read) && read.paise > 0) {
    const committed = commitmentTotal(expense.commitment, guestCount);
    const left = committed - paidTotal(expense);
    if (read.paise > left) {
      errors.amount =
        left > 0
          ? `Only ${formatMoney(left)} of the agreed ${formatMoney(committed)} is outstanding. A payment cannot exceed it.`
          : `The agreed ${formatMoney(committed)} is already fully paid.`;
    }
  }
  if (Object.keys(errors).length > 0 || 'error' in read) return { ok: false, errors };

  const parsed = paymentSchema.safeParse({
    id,
    amountPaise: read.paise,
    date: values.date,
  });
  if (!parsed.success) {
    const dateIssue = parsed.error.issues.find((i) => i.path[0] === 'date');
    return {
      ok: false,
      errors: dateIssue
        ? { date: dateIssue.message }
        : { amount: parsed.error.issues[0]?.message ?? 'Not a valid payment' },
    };
  }
  return { ok: true, payment: parsed.data };
}
