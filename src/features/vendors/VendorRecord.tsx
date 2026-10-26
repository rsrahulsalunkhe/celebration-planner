import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useCalendar } from '@/app/state/plannerContext.ts';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import type { Option } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import { TextField } from '@/components/TextField.tsx';
import { VENDOR_STATUS_LABELS } from '@/data/labels.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatDate } from '@/domain/dates.ts';
import { createId } from '@/domain/ids.ts';
import { formatMoney, formatMoneyInput } from '@/domain/money.ts';
import { commitmentTotal, paidTotal } from '@/domain/planning/forecast.ts';
import {
  CAPABILITY_LABELS,
  VENDOR_KIND_LABELS,
  agreedQuoteOperations,
  budgetCategoryFor,
  depositPaymentId,
  linkedExpense,
  vendorChecklist,
  type Requirement,
  type SampleVendor,
} from '@/domain/planning/vendors.ts';
import type {
  Capability,
  ChangeOperation,
  EventRecord,
  Vendor,
  VendorStatus,
} from '@/domain/types.ts';
import { readAmount } from '../budget/expenseForm.ts';
import styles from './Vendors.module.css';

type Commit = (operations: readonly ChangeOperation[], success: string) => boolean;

const STATUS_OPTIONS: Option<VendorStatus>[] = (
  Object.keys(VENDOR_STATUS_LABELS) as VendorStatus[]
).map((value) => ({ value, label: VENDOR_STATUS_LABELS[value] }));

type Known = 'unknown' | 'yes' | 'no';
const KNOWN_OPTIONS: Option<Known>[] = [
  { value: 'unknown', label: 'Not confirmed yet' },
  { value: 'yes', label: 'They confirmed they can' },
  { value: 'no', label: 'They cannot' },
];

interface DetailValues {
  status: VendorStatus;
  contact: string;
  quote: string;
  notes: string;
  serviceArea: string;
  capacity: string;
  capabilities: Partial<Record<Capability, Known>>;
}

/**
 * One vendor on the organizer's list: what they recorded (status, contact,
 * quote, notes, confirmed capabilities), the checklist of questions, and the
 * agreed quote that links to one budget expense. Everything here is the
 * organizer's own record; nothing is sent or booked.
 */
export function VendorRecord({
  event,
  vendor,
  sample,
  requirements,
  commit,
}: {
  event: EventRecord;
  vendor: Vendor;
  sample: SampleVendor | null;
  requirements: readonly Requirement[];
  commit: Commit;
}) {
  const checklist = vendorChecklist(event, vendor.kind, PLANNING_CONFIGURATION, sample);
  const done = new Set(vendor.checksDone ?? []);
  const linked = linkedExpense(event, vendor.id);

  const detailsKey = JSON.stringify([
    vendor.status,
    vendor.contact,
    vendor.quotePaise,
    vendor.notes,
    vendor.serviceArea,
    vendor.capacityMax,
    vendor.capabilities,
  ]);
  const quoteKey = JSON.stringify([linked?.id, linked?.commitment, linked?.payments]);

  return (
    <li className={styles.record}>
      <h3>{vendor.name}</h3>
      <div className={styles.badges}>
        {sample ? (
          <Badge tone="gold">Sample data</Badge>
        ) : (
          <Badge tone="success">Your record</Badge>
        )}
        <Badge>{VENDOR_KIND_LABELS[vendor.kind]}</Badge>
        <Badge tone={vendor.status === 'booked' ? 'navy' : 'neutral'}>
          {VENDOR_STATUS_LABELS[vendor.status]}
        </Badge>
      </div>
      {vendor.status === 'booked' ? (
        <p className={styles.muted}>
          “Booked” is your own record. This app does not contact vendors or make
          reservations.
        </p>
      ) : null}

      <VendorDetails
        key={detailsKey}
        vendor={vendor}
        requirements={requirements}
        commit={commit}
        linkedName={linked?.name ?? null}
      />

      <div className={styles.section}>
        <h4>
          Questions to ask ({done.size} of {checklist.length} checked)
        </h4>
        <p className={styles.muted}>
          Your own checks. Ticking one records that you asked; it is not verified by this
          app.
        </p>
        <ul className={styles.checklist}>
          {checklist.map((q) => (
            <li key={q.id}>
              <Checkbox
                label={q.text}
                checked={done.has(q.id)}
                onChange={(checked) => {
                  const next = checked
                    ? [...done, q.id]
                    : [...done].filter((id) => id !== q.id);
                  const { checksDone: _old, ...rest } = vendor;
                  commit(
                    [
                      {
                        op: 'vendors/upsert',
                        item: next.length > 0 ? { ...rest, checksDone: next } : rest,
                      },
                    ],
                    checked ? 'Marked as checked.' : 'Marked as not checked.',
                  );
                }}
              />
            </li>
          ))}
        </ul>
      </div>

      <AgreedQuote key={quoteKey} event={event} vendor={vendor} commit={commit} />
    </li>
  );
}

function AgreedQuote({
  event,
  vendor,
  commit,
}: {
  event: EventRecord;
  vendor: Vendor;
  commit: Commit;
}) {
  const today = useCalendar().today();
  const linked = linkedExpense(event, vendor.id);
  const prefix = `quote-${vendor.id}`;
  const defaultCategory =
    budgetCategoryFor(event, vendor.kind) ?? event.budgetCategories[0]?.id ?? '';
  const defaultExpense =
    linked?.id ??
    event.expenses.find(
      (e) => e.categoryId === defaultCategory && e.vendorId === undefined,
    )?.id ??
    'new';
  const depositPayment = linked?.payments.find(
    (p) => p.id === depositPaymentId(vendor.id),
  );
  const [basis, setBasis] = useState<'fixed' | 'per-guest'>(
    linked?.commitment?.basis ?? 'fixed',
  );
  const [amount, setAmount] = useState(() => {
    const c = linked?.commitment;
    if (!c) return '';
    return formatMoneyInput(c.basis === 'fixed' ? c.totalPaise : c.perGuestPaise);
  });
  const [deposit, setDeposit] = useState(
    linked?.commitment?.depositPaise
      ? formatMoneyInput(linked.commitment.depositPaise)
      : '',
  );
  const [paidOn, setPaidOn] = useState(depositPayment?.date ?? '');
  const [expenseId, setExpenseId] = useState(defaultExpense);
  const [categoryId, setCategoryId] = useState(defaultCategory);
  const [errors, setErrors] = useState<{
    amount?: string;
    deposit?: string;
    form?: string;
  }>({});

  if (event.budgetCategories.length === 0) {
    return (
      <div className={styles.section}>
        <h4>Agreed quote</h4>
        <p className={styles.muted}>
          Create a budget on the Budget page first, so an agreed quote has an expense to
          link to.
        </p>
      </div>
    );
  }

  const expenseOptions: Option[] = [
    ...event.expenses
      .filter((e) => e.vendorId === undefined || e.vendorId === vendor.id)
      .map((e) => ({ value: e.id, label: e.name })),
    { value: 'new', label: 'A new expense' },
  ];
  const categoryOptions: Option[] = event.budgetCategories.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const nextErrors: typeof errors = {};
    const read = readAmount(amount, basis === 'fixed' ? '110000' : '650');
    if ('error' in read) nextErrors.amount = read.error;
    let depositPaise: number | undefined;
    if (deposit.trim() !== '') {
      const d = readAmount(deposit, '30000');
      if ('error' in d) nextErrors.deposit = d.error;
      else depositPaise = d.paise;
    }
    if (Object.keys(nextErrors).length > 0 || 'error' in read) {
      setErrors(nextErrors);
      return;
    }
    const result = agreedQuoteOperations(event, vendor, {
      basis,
      amountPaise: read.paise,
      ...(depositPaise ? { depositPaise } : {}),
      ...(paidOn && depositPaise ? { depositPaidOn: paidOn } : {}),
      expenseId,
      categoryId,
      newExpenseId: createId('expense'),
    });
    if (!result.ok) {
      setErrors({ form: result.issues.join(' ') });
      return;
    }
    const expenseName =
      event.expenses.find((e) => e.id === result.expenseId)?.name ?? vendor.name;
    if (
      commit(
        result.operations,
        `${result.created ? 'Created' : 'Updated'} the linked expense “${expenseName}” with the agreed amount. The agreement replaces its estimate in the forecast${depositPaise ? '; the deposit is part of the agreed total, not extra' : ''}.`,
      )
    ) {
      setErrors({});
    }
  };

  const committed = linked?.commitment
    ? commitmentTotal(linked.commitment, event.profile.guestCount)
    : null;

  return (
    <div className={styles.section}>
      <h4>Agreed quote</h4>
      {linked && committed !== null ? (
        <p>
          Linked to the expense “{linked.name}”: agreed {formatMoney(committed)}, paid{' '}
          {formatMoney(paidTotal(linked))}
          {depositPayment ? ` (deposit paid ${formatDate(depositPayment.date)})` : ''}.
        </p>
      ) : (
        <p className={styles.muted}>
          Record what you agreed. It updates one expense in the budget; recording it again
          updates the same expense.
        </p>
      )}
      <form
        className={styles.form}
        onSubmit={submit}
        noValidate
        aria-label={`Agreed quote for ${vendor.name}`}
      >
        {linked ? null : (
          <Select
            name={`${prefix}-expense`}
            label="Expense this quote covers"
            value={expenseId}
            options={expenseOptions}
            hint="Choose the estimate it replaces, so the cost is not counted twice."
            onChange={(v) => {
              if (v) setExpenseId(v);
            }}
          />
        )}
        {!linked && expenseId === 'new' ? (
          <Select
            name={`${prefix}-category`}
            label="Budget category"
            value={categoryId}
            options={categoryOptions}
            onChange={(v) => {
              if (v) setCategoryId(v);
            }}
          />
        ) : null}
        <Select
          name={`${prefix}-basis`}
          label="Agreed as"
          value={basis}
          options={[
            { value: 'fixed', label: 'A fixed total' },
            { value: 'per-guest', label: 'A rate per guest' },
          ]}
          onChange={(v) => {
            if (v) setBasis(v);
          }}
        />
        <TextField
          name={`${prefix}-amount`}
          required
          label={basis === 'fixed' ? 'Agreed total' : 'Agreed rate per guest'}
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          error={errors.amount}
          onChange={(v) => {
            setAmount(v);
            setErrors((e) => ({ ...e, amount: undefined, form: undefined }));
          }}
        />
        <TextField
          name={`${prefix}-deposit`}
          label="Deposit (optional)"
          value={deposit}
          inputMode="decimal"
          autoComplete="off"
          hint="Part of the agreed total, never extra."
          error={errors.deposit}
          onChange={(v) => {
            setDeposit(v);
            setErrors((e) => ({ ...e, deposit: undefined, form: undefined }));
          }}
        />
        <TextField
          name={`${prefix}-paid-on`}
          label="Deposit paid on (optional)"
          type="date"
          value={paidOn}
          hint={`Leave blank if not paid yet. Today is ${formatDate(today)}.`}
          onChange={(v) => {
            setPaidOn(v);
          }}
        />
        {errors.form ? (
          <p className={`${styles.note} ${styles.wide}`} role="alert">
            {errors.form}
          </p>
        ) : null}
        <div className={`${styles.buttons} ${styles.wide}`}>
          <Button type="submit">
            {linked ? 'Update agreed quote' : 'Record agreed quote'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The editable details. Remounted (by key) whenever the saved values change. */
function VendorDetails({
  vendor,
  requirements,
  commit,
  linkedName,
}: {
  vendor: Vendor;
  requirements: readonly Requirement[];
  commit: Commit;
  linkedName: string | null;
}) {
  const prefix = `vendor-${vendor.id}`;
  const [values, setValues] = useState<DetailValues>(() => ({
    status: vendor.status,
    contact: vendor.contact ?? '',
    quote: vendor.quotePaise === null ? '' : formatMoneyInput(vendor.quotePaise),
    notes: vendor.notes ?? '',
    serviceArea: vendor.serviceArea ?? '',
    capacity: vendor.capacityMax === undefined ? '' : String(vendor.capacityMax),
    capabilities: Object.fromEntries(
      requirements.map((r) => {
        const v = vendor.capabilities?.[r.capability];
        return [r.capability, v === undefined ? 'unknown' : v ? 'yes' : 'no'];
      }),
    ),
  }));
  const [errors, setErrors] = useState<{
    quote?: string;
    capacity?: string;
    contact?: string;
  }>({});
  const sample = vendor.sampleId !== undefined;
  const saveDetails = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const nextErrors: typeof errors = {};
    let quotePaise: number | null = null;
    if (values.quote.trim() !== '') {
      const read = readAmount(values.quote, '50000');
      if ('error' in read) nextErrors.quote = read.error;
      else quotePaise = read.paise;
    }
    let capacityMax: number | undefined;
    if (values.capacity.trim() !== '') {
      if (/^\d+$/.test(values.capacity.trim()))
        capacityMax = Number(values.capacity.trim());
      else nextErrors.capacity = 'Enter a whole number of guests, like 150';
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    const capabilities: Partial<Record<Capability, boolean>> = { ...vendor.capabilities };
    for (const [key, known] of Object.entries(values.capabilities) as [
      Capability,
      Known,
    ][]) {
      if (known === 'unknown') delete capabilities[key];
      else capabilities[key] = known === 'yes';
    }
    const {
      contact: _c,
      notes: _n,
      serviceArea: _s,
      capacityMax: _m,
      capabilities: _k,
      ...base
    } = vendor;
    const contact = values.contact.trim();
    const notes = values.notes.trim();
    const serviceArea = values.serviceArea.trim();
    const next: Vendor = {
      ...base,
      status: values.status,
      quotePaise,
      ...(contact ? { contact } : {}),
      ...(notes ? { notes } : {}),
      ...(serviceArea ? { serviceArea } : {}),
      ...(capacityMax !== undefined ? { capacityMax } : {}),
      ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
    };
    const saved = commit(
      [{ op: 'vendors/upsert', item: next }],
      next.status === 'booked'
        ? `Saved ${vendor.name}, recorded as booked. This is your note: no reservation was made from this app.`
        : `Saved ${vendor.name}.`,
    );
    if (saved) setErrors({});
  };

  return (
    <form
      className={styles.form}
      onSubmit={saveDetails}
      noValidate
      aria-label={`Details for ${vendor.name}`}
    >
      <Select
        name={`${prefix}-status`}
        label="Selection status"
        value={values.status}
        options={STATUS_OPTIONS}
        onChange={(v) => {
          if (v) setValues((s) => ({ ...s, status: v }));
        }}
      />
      <TextField
        name={`${prefix}-contact`}
        label="Contact (your note)"
        value={values.contact}
        maxLength={120}
        autoComplete="off"
        hint="Whatever you use to reach them. Stored only in this browser."
        error={errors.contact}
        onChange={(v) => {
          setValues((s) => ({ ...s, contact: v }));
        }}
      />
      <TextField
        name={`${prefix}-quote`}
        label="Latest quote, in rupees"
        value={values.quote}
        inputMode="decimal"
        autoComplete="off"
        hint="Leave blank if there is no quote yet."
        error={errors.quote}
        onChange={(v) => {
          setValues((s) => ({ ...s, quote: v }));
          setErrors((e) => ({ ...e, quote: undefined }));
        }}
      />
      {!sample ? (
        <>
          <TextField
            name={`${prefix}-area`}
            label="Service area"
            value={values.serviceArea}
            maxLength={100}
            autoComplete="off"
            onChange={(v) => {
              setValues((s) => ({ ...s, serviceArea: v }));
            }}
          />
          <TextField
            name={`${prefix}-capacity`}
            label="Most guests they can serve"
            value={values.capacity}
            inputMode="numeric"
            error={errors.capacity}
            onChange={(v) => {
              setValues((s) => ({ ...s, capacity: v }));
              setErrors((e) => ({ ...e, capacity: undefined }));
            }}
          />
        </>
      ) : null}
      {requirements.map((r) => (
        <Select
          key={r.capability}
          name={`${prefix}-cap-${r.capability}`}
          label={`${CAPABILITY_LABELS[r.capability]} (needed)`}
          value={values.capabilities[r.capability] ?? 'unknown'}
          options={KNOWN_OPTIONS}
          onChange={(v) => {
            if (v) {
              setValues((s) => ({
                ...s,
                capabilities: { ...s.capabilities, [r.capability]: v },
              }));
            }
          }}
        />
      ))}
      <div className={styles.wide}>
        <TextField
          name={`${prefix}-notes`}
          label="Notes"
          value={values.notes}
          multiline
          maxLength={500}
          onChange={(v) => {
            setValues((s) => ({ ...s, notes: v }));
          }}
        />
      </div>
      <div className={`${styles.buttons} ${styles.wide}`}>
        <Button type="submit">Save details</Button>
        <ConfirmAction
          label="Remove"
          accessibleName={`Remove ${vendor.name}`}
          title="Remove this vendor?"
          icon={<Trash2 aria-hidden size={18} />}
          confirmLabel="Yes, remove"
          message={`“${vendor.name}” will be removed from your list.${linkedName ? ` The expense “${linkedName}” stays in the budget but is no longer linked to it.` : ''}`}
          onConfirm={() => {
            commit(
              [{ op: 'vendors/remove', itemId: vendor.id }],
              `Removed ${vendor.name}.`,
            );
          }}
        />
      </div>
    </form>
  );
}
