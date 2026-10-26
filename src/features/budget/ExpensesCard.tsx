import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useCalendar } from '@/app/state/plannerContext.ts';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import type { Option } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import { TextField } from '@/components/TextField.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatDate } from '@/domain/dates.ts';
import { createId } from '@/domain/ids.ts';
import { formatMoney, parseMoney } from '@/domain/money.ts';
import type { BudgetLedger, LedgerItem } from '@/domain/planning/budget.ts';
import { commitmentTotal, paidTotal } from '@/domain/planning/forecast.ts';
import { CURRENCY, LIMITS } from '@/domain/primitives.ts';
import type { EventRecord, ExpenseItem } from '@/domain/types.ts';
import styles from './Budget.module.css';
import { costText, type Commit, type Report } from './budgetFormat.ts';
import {
  EXPENSE_FIELD_ORDER,
  parseExpenseForm,
  parsePaymentForm,
  valuesFromExpense,
  type Basis,
  type CommitmentChoice,
  type ExpenseField,
  type ExpenseFormErrors,
  type ExpenseFormValues,
} from './expenseForm.ts';

const FIELD_NAMES: Record<ExpenseField, string> = {
  name: 'expense-name',
  categoryId: 'expense-category',
  estimateBasis: 'expense-estimate-basis',
  estimateAmount: 'expense-estimate-amount',
  commitmentBasis: 'expense-commitment-basis',
  commitmentAmount: 'expense-commitment-amount',
  notes: 'expense-notes',
};

const BASIS_OPTIONS: Option<Basis>[] = [
  { value: 'fixed', label: 'Fixed total' },
  { value: 'per-guest', label: 'Per guest' },
];

const COMMITMENT_OPTIONS: Option<CommitmentChoice>[] = [
  { value: 'none', label: 'Nothing agreed yet' },
  { value: 'fixed', label: 'Agreed fixed total' },
  { value: 'per-guest', label: 'Agreed per-guest rate' },
];

/** Live "× guests" arithmetic under a per-guest amount, so the total is visible before saving. */
function amountHint(basis: Basis, text: string, guests: number): string {
  if (basis === 'fixed') return 'In rupees, like 25000 or 1,25,000.50';
  const paise = parseMoney(text, CURRENCY);
  return paise === null
    ? `Per guest, in rupees. Multiplied by ${guests} guests.`
    : `× ${guests} guests = ${formatMoney(paise * guests)}`;
}

function ItemBadges({ item }: { item: LedgerItem }) {
  return (
    <span className={styles.cellStack}>
      {item.estimateOrigin === 'generated' ? (
        <Badge tone="gold">Illustrative rate</Badge>
      ) : (
        <Badge tone="success">Your estimate</Badge>
      )}
      {item.commitment ? <Badge tone="navy">Agreed</Badge> : null}
      {item.requirement ? <Badge tone="coral">Required</Badge> : null}
      {item.optional ? <Badge>Optional</Badge> : null}
      {item.issues.length > 0 ? <Badge tone="coral">Check payments</Badge> : null}
    </span>
  );
}

type Mode = { kind: 'add' } | { kind: 'edit'; id: string } | null;

export function ExpensesCard({
  event,
  ledger,
  commit,
  report,
}: {
  event: EventRecord;
  ledger: BudgetLedger;
  commit: Commit;
  report: Report;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const categoryName = new Map(event.budgetCategories.map((c) => [c.id, c.name]));
  const order = new Map(event.budgetCategories.map((c, i) => [c.id, i]));
  const items = [...ledger.items].sort(
    (a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0),
  );
  const editing =
    mode?.kind === 'edit' ? (event.expenses.find((e) => e.id === mode.id) ?? null) : null;
  const atLimit = event.expenses.length >= LIMITS.expenses;

  const close = (focusId: string) => {
    setMode(null);
    setTimeout(() => {
      document.getElementById(focusId)?.focus();
    }, 0);
  };

  return (
    <Card
      title="Expenses"
      description={`${PLANNING_CONFIGURATION.ratesDisclosure} Each item counts its agreed total when there is one, otherwise its estimate.`}
      actions={
        <Button
          id="add-expense"
          icon={<Plus aria-hidden size={18} />}
          disabled={atLimit}
          onClick={() => {
            setMode({ kind: 'add' });
          }}
        >
          Add expense
        </Button>
      }
    >
      {atLimit ? (
        <p className={styles.note}>
          This event has the most expenses allowed ({LIMITS.expenses}).
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className={styles.muted}>No expenses yet.</p>
      ) : (
        <div
          className={styles.tableWrap}
          role="region"
          aria-labelledby="expenses-caption"
          tabIndex={0}
        >
          <table className={styles.table}>
            <caption id="expenses-caption">
              Estimates, agreed amounts and payments for {ledger.guestCount} guests
            </caption>
            <thead>
              <tr>
                <th scope="col">Expense</th>
                <th scope="col">Category</th>
                <th scope="col">Estimate</th>
                <th scope="col">Agreed</th>
                <th scope="col" className={styles.num}>
                  Paid
                </th>
                <th scope="col" className={styles.num}>
                  Outstanding
                </th>
                <th scope="col" className={styles.num}>
                  In forecast
                </th>
                <th scope="col">
                  <span className="srOnly">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.expenseId}>
                  <th scope="row">
                    {item.name}
                    <ItemBadges item={item} />
                  </th>
                  <td>{categoryName.get(item.categoryId)}</td>
                  <td>
                    {costText(item.estimate, ledger.guestCount)}
                    {item.commitment ? (
                      <span className={styles.detail}>Replaced by the agreed amount</span>
                    ) : null}
                  </td>
                  <td>
                    {item.commitment
                      ? costText(item.commitment, ledger.guestCount)
                      : 'Not agreed'}
                  </td>
                  <td className={styles.num}>{formatMoney(item.paidPaise)}</td>
                  <td className={styles.num}>
                    {item.committedPaise === null
                      ? '—'
                      : formatMoney(item.outstandingPaise)}
                  </td>
                  <td className={styles.num}>
                    {formatMoney(item.forecastPaise)}
                    <span className={styles.detail}>
                      {item.basis === 'commitment' ? 'agreed' : 'estimate'}
                    </span>
                  </td>
                  <td>
                    <Button
                      id={`edit-expense-${item.expenseId}`}
                      variant="ghost"
                      icon={<Pencil aria-hidden size={14} />}
                      aria-label={`Edit ${item.name}`}
                      onClick={() => {
                        setMode({ kind: 'edit', id: item.expenseId });
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>
                  All expenses
                </th>
                <td className={styles.num}>{formatMoney(ledger.paidPaise)}</td>
                <td className={styles.num}>{formatMoney(ledger.outstandingPaise)}</td>
                <td className={styles.num}>{formatMoney(ledger.forecastPaise)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {mode ? (
        <ExpenseEditor
          key={mode.kind === 'edit' ? mode.id : 'new'}
          event={event}
          expense={editing}
          commit={commit}
          report={report}
          onDone={(focusId) => {
            close(focusId);
          }}
        />
      ) : null}
    </Card>
  );
}

function ExpenseEditor({
  event,
  expense,
  commit,
  report,
  onDone,
}: {
  event: EventRecord;
  expense: ExpenseItem | null;
  commit: Commit;
  report: Report;
  onDone: (focusId: string) => void;
}) {
  const guests = event.profile.guestCount;
  const [values, setValues] = useState<ExpenseFormValues>(() =>
    valuesFromExpense(expense, event.budgetCategories[0]?.id ?? ''),
  );
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const returnFocus = expense ? `edit-expense-${expense.id}` : 'add-expense';

  useEffect(() => {
    document.getElementById('expense-editor-heading')?.focus();
  }, []);

  const set = <K extends ExpenseField>(field: K, value: ExpenseFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const result = parseExpenseForm(values, {
      existing: expense,
      newId: createId('expense'),
      guestCount: guests,
      preferences: event.preferences,
    });
    if (!result.ok) {
      setErrors(result.errors);
      const first = EXPENSE_FIELD_ORDER.find((f) => result.errors[f]);
      if (first) document.getElementById(`field-${FIELD_NAMES[first]}`)?.focus();
      return;
    }
    const saved = commit(
      [{ op: 'expenses/upsert', item: result.expense }],
      expense ? `Saved ${result.expense.name}.` : `Added ${result.expense.name}.`,
    );
    if (saved) onDone(expense ? `edit-expense-${expense.id}` : 'add-expense');
  };

  const categoryOptions: Option[] = event.budgetCategories.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const required = expense?.requirement !== undefined;
  const canRemove = expense !== null && expense.payments.length === 0 && !required;

  return (
    <section className={styles.section} aria-labelledby="expense-editor-heading">
      <h3 id="expense-editor-heading" tabIndex={-1}>
        {expense ? `Edit ${expense.name}` : 'Add an expense'}
      </h3>
      {expense?.estimateOrigin === 'generated' ? (
        <p className={`${styles.note} ${styles.formWide}`}>
          The estimate is an illustrative rate, not a quote. Changing it makes it your
          estimate, and a later plan update will keep it.
        </p>
      ) : null}
      <form className={`${styles.form} ${styles.section}`} onSubmit={submit} noValidate>
        <TextField
          name={FIELD_NAMES.name}
          label="Name"
          value={values.name}
          maxLength={100}
          autoComplete="off"
          required
          error={errors.name}
          onChange={(v) => {
            set('name', v);
          }}
        />
        <Select
          name={FIELD_NAMES.categoryId}
          label="Category"
          value={values.categoryId}
          options={categoryOptions}
          required
          error={errors.categoryId}
          onChange={(v) => {
            set('categoryId', v);
          }}
        />
        <Select
          name={FIELD_NAMES.estimateBasis}
          label="Estimate is"
          value={values.estimateBasis}
          options={BASIS_OPTIONS}
          onChange={(v) => {
            if (v) set('estimateBasis', v);
          }}
        />
        <TextField
          name={FIELD_NAMES.estimateAmount}
          label={
            values.estimateBasis === 'fixed' ? 'Estimate, total' : 'Estimate per guest'
          }
          value={values.estimateAmount}
          inputMode="decimal"
          autoComplete="off"
          required
          hint={amountHint(values.estimateBasis, values.estimateAmount, guests)}
          error={errors.estimateAmount}
          onChange={(v) => {
            set('estimateAmount', v);
          }}
        />
        <Select
          name={FIELD_NAMES.commitmentBasis}
          label="Agreed with the vendor"
          value={values.commitmentBasis}
          options={COMMITMENT_OPTIONS}
          hint="An agreed amount replaces the estimate in the forecast."
          error={errors.commitmentBasis}
          onChange={(v) => {
            if (v) set('commitmentBasis', v);
          }}
        />
        {values.commitmentBasis !== 'none' ? (
          <TextField
            name={FIELD_NAMES.commitmentAmount}
            label={
              values.commitmentBasis === 'fixed'
                ? 'Agreed total'
                : 'Agreed rate per guest'
            }
            value={values.commitmentAmount}
            inputMode="decimal"
            autoComplete="off"
            required
            hint={amountHint(values.commitmentBasis, values.commitmentAmount, guests)}
            error={errors.commitmentAmount}
            onChange={(v) => {
              set('commitmentAmount', v);
            }}
          />
        ) : null}
        <div className={styles.formWide}>
          <TextField
            name={FIELD_NAMES.notes}
            label="Notes"
            value={values.notes}
            multiline
            maxLength={500}
            error={errors.notes}
            onChange={(v) => {
              set('notes', v);
            }}
          />
        </div>
        <div className={`${styles.buttons} ${styles.formWide}`}>
          <Button type="submit">{expense ? 'Save expense' : 'Save new expense'}</Button>
          <Button
            variant="secondary"
            icon={<X aria-hidden size={18} />}
            onClick={() => {
              onDone(returnFocus);
            }}
          >
            Cancel
          </Button>
          {canRemove ? (
            <ConfirmAction
              label="Remove expense"
              accessibleName={`Remove ${expense.name}`}
              title="Remove this expense?"
              icon={<Trash2 aria-hidden size={18} />}
              confirmLabel="Yes, remove it"
              message={`“${expense.name}” will be removed from the budget. Its estimate${expense.commitment ? ' and agreed amount' : ''} will no longer count in the forecast.`}
              onConfirm={() => {
                if (
                  commit(
                    [{ op: 'expenses/remove', itemId: expense.id }],
                    `Removed ${expense.name}.`,
                  )
                ) {
                  onDone('add-expense');
                }
              }}
            />
          ) : null}
        </div>
        {expense && !canRemove ? (
          <p className={`${styles.muted} ${styles.formWide}`}>
            {required
              ? 'This item meets a need you stated, so it cannot be removed here. Remove the need from the event first if it no longer applies.'
              : 'This item has payments recorded. Remove the payments before removing the item.'}
          </p>
        ) : null}
      </form>
      {expense ? (
        <PaymentsSection
          event={event}
          expense={expense}
          commit={commit}
          report={report}
        />
      ) : null}
    </section>
  );
}

function PaymentsSection({
  event,
  expense,
  commit,
  report,
}: {
  event: EventRecord;
  expense: ExpenseItem;
  commit: Commit;
  report: Report;
}) {
  const calendar = useCalendar();
  const guests = event.profile.guestCount;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(calendar.today());
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});
  const committed = expense.commitment
    ? commitmentTotal(expense.commitment, guests)
    : null;
  const paid = paidTotal(expense);

  const add = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (expense.payments.length >= LIMITS.paymentsPerExpense) {
      report(`An expense can hold up to ${LIMITS.paymentsPerExpense} payments.`, 'error');
      return;
    }
    const result = parsePaymentForm(
      { amount, date },
      expense,
      guests,
      createId('payment'),
    );
    if (!result.ok) {
      setErrors(result.errors);
      document
        .getElementById(
          result.errors.amount ? 'field-payment-amount' : 'field-payment-date',
        )
        ?.focus();
      return;
    }
    if (
      commit(
        [
          {
            op: 'expenses/upsert',
            item: { ...expense, payments: [...expense.payments, result.payment] },
          },
        ],
        `Recorded a payment of ${formatMoney(result.payment.amountPaise)} for ${expense.name}. The forecast is unchanged; outstanding is now ${formatMoney((committed ?? 0) - paid - result.payment.amountPaise)}.`,
      )
    ) {
      setAmount('');
      setErrors({});
    }
  };

  return (
    <div className={styles.section}>
      <h4>Payments</h4>
      {committed === null ? (
        <p className={styles.muted}>
          Payments are part of an agreed amount. Choose “Agreed fixed total” or “Agreed
          per-guest rate” above and save before recording a payment.
        </p>
      ) : (
        <>
          <p>
            Paid {formatMoney(paid)} of the agreed {formatMoney(committed)}.{' '}
            {formatMoney(Math.max(0, committed - paid))} outstanding.
          </p>
          {expense.payments.length > 0 ? (
            <ul className={`${styles.list} ${styles.section}`} aria-label="Payments made">
              {expense.payments.map((p) => (
                <li key={p.id} className={styles.cellStack}>
                  {formatMoney(p.amountPaise)} on {formatDate(p.date)}
                  <Button
                    variant="ghost"
                    aria-label={`Remove payment of ${formatMoney(p.amountPaise)} on ${formatDate(p.date)}`}
                    onClick={() => {
                      commit(
                        [
                          {
                            op: 'expenses/upsert',
                            item: {
                              ...expense,
                              payments: expense.payments.filter((x) => x.id !== p.id),
                            },
                          },
                        ],
                        `Removed the payment of ${formatMoney(p.amountPaise)}.`,
                      );
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className={`${styles.inline} ${styles.section}`}
            onSubmit={add}
            noValidate
            aria-label={`Record a payment for ${expense.name}`}
          >
            <TextField
              name="payment-amount"
              required
              label="Payment amount"
              value={amount}
              inputMode="decimal"
              autoComplete="off"
              hint="In rupees. Part of the agreed amount, not extra."
              error={errors.amount}
              onChange={(v) => {
                setAmount(v);
                setErrors((e) => ({ ...e, amount: undefined }));
              }}
            />
            <TextField
              name="payment-date"
              label="Paid on"
              type="date"
              value={date}
              error={errors.date}
              onChange={(v) => {
                setDate(v);
                setErrors((e) => ({ ...e, date: undefined }));
              }}
            />
            <Button type="submit" variant="secondary">
              Record payment
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
