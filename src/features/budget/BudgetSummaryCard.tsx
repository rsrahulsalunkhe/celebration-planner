import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { FactList } from '@/components/FactList.tsx';
import { TextField } from '@/components/TextField.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatMoney } from '@/domain/money.ts';
import { setReserveEdit, type BudgetLedger } from '@/domain/planning/budget.ts';
import { MAX_RESERVE_BASIS_POINTS } from '@/domain/primitives.ts';
import type { EventRecord } from '@/domain/types.ts';
import styles from './Budget.module.css';
import { money, pct, type Commit } from './budgetFormat.ts';
import { readPercent } from './expenseForm.ts';

/**
 * The budget split into reserve, targets and anything unassigned, drawn as
 * one bar. The figures are in the list beside it, so the bar is decorative.
 */
function CompositionBar({ ledger }: { ledger: BudgetLedger }) {
  const assigned = Math.min(ledger.targetsPaise, ledger.spendablePaise);
  const over = Math.max(0, -ledger.allocationDifferencePaise);
  const unallocated = Math.max(0, ledger.allocationDifferencePaise);
  const scale = Math.max(1, ledger.budgetPaise + over);
  const segments = [
    {
      key: 'reserve',
      label: 'Reserve',
      paise: ledger.reservePaise,
      className: styles.reserve,
    },
    {
      key: 'targets',
      label: 'Category targets',
      paise: assigned,
      className: styles.targets,
    },
    {
      key: 'unallocated',
      label: 'Not allocated',
      paise: unallocated,
      className: styles.unallocated,
    },
    {
      key: 'over',
      label: 'Targets over the budget',
      paise: over,
      className: styles.over,
    },
  ].filter((s) => s.paise > 0);

  return (
    <figure className={styles.figure}>
      <figcaption>
        How the budget is divided (the same figures are listed above)
      </figcaption>
      <div className={styles.composition} aria-hidden="true">
        {segments.map((s) => (
          <span
            key={s.key}
            className={`${styles.segment} ${s.className ?? ''}`}
            style={{ flexGrow: s.paise / scale, flexBasis: 0 }}
            title={`${s.label}: ${formatMoney(s.paise)}`}
          />
        ))}
      </div>
      <ul className={styles.legend}>
        {segments.map((s) => (
          <li key={s.key}>
            <span
              className={`${styles.swatch} ${s.className ?? ''}`}
              aria-hidden="true"
            />
            {s.label}: {formatMoney(s.paise)}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function BudgetSummaryCard({
  event,
  ledger,
  commit,
}: {
  event: EventRecord;
  ledger: BudgetLedger;
  commit: Commit;
}) {
  const [reserveText, setReserveText] = useState(String(ledger.reserveBasisPoints / 100));
  const [reserveError, setReserveError] = useState<string | undefined>();
  const hasBudget = event.budgetCategories.length > 0;

  const saveReserve = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const read = readPercent(reserveText);
    if ('error' in read) {
      setReserveError(read.error);
      document.getElementById('field-reserve-percent')?.focus();
      return;
    }
    const edit = setReserveEdit(event, PLANNING_CONFIGURATION, read.basisPoints);
    if (!edit.ok) {
      setReserveError(edit.issues[0]);
      return;
    }
    const moved = edit.rebalance.changes.length;
    commit(
      edit.operations,
      `Reserve set to ${pct(read.basisPoints)}.${moved > 0 ? ` ${moved} unlocked ${moved === 1 ? 'target was' : 'targets were'} re-shared around it.` : ''}`,
    );
    setReserveError(undefined);
  };

  return (
    <Card
      title="Budget at a glance"
      description="Forecast uses each item's agreed total when there is one, otherwise its estimate. Payments are part of what is agreed, never an extra cost."
    >
      <FactList
        facts={[
          { label: 'Total budget', value: formatMoney(ledger.budgetPaise) },
          {
            label: `Reserve (${pct(ledger.reserveBasisPoints)}, ${ledger.reserveIsDefault ? 'default' : 'your setting'})`,
            value: formatMoney(ledger.reservePaise),
          },
          { label: 'Left after the reserve', value: formatMoney(ledger.spendablePaise) },
          { label: 'Forecast cost', value: formatMoney(ledger.forecastPaise) },
          { label: 'Agreed (committed)', value: formatMoney(ledger.committedPaise) },
          { label: 'Paid', value: formatMoney(ledger.paidPaise) },
          { label: 'Outstanding', value: formatMoney(ledger.outstandingPaise) },
          {
            label: 'Headroom',
            value: (
              <span className={ledger.headroomPaise < 0 ? styles.negative : undefined}>
                {money(ledger.headroomPaise)}
              </span>
            ),
          },
        ]}
      />
      <p className={styles.equation}>
        Headroom = budget {formatMoney(ledger.budgetPaise)} − reserve{' '}
        {formatMoney(ledger.reservePaise)} − forecast {formatMoney(ledger.forecastPaise)}{' '}
        = <strong>{money(ledger.headroomPaise)}</strong>.{' '}
        {ledger.shortfallPaise > 0 ? (
          <Badge tone="coral">
            {formatMoney(ledger.shortfallPaise)} over the whole budget
          </Badge>
        ) : ledger.headroomPaise < 0 ? (
          <Badge tone="gold">
            Uses {formatMoney(-ledger.headroomPaise)} of the reserve
          </Badge>
        ) : null}
      </p>
      {hasBudget ? <CompositionBar ledger={ledger} /> : null}

      <form
        className={`${styles.section} ${styles.inline}`}
        onSubmit={saveReserve}
        noValidate
      >
        <TextField
          name="reserve-percent"
          label="Reserve, % of budget"
          value={reserveText}
          inputMode="decimal"
          hint={`0 to ${MAX_RESERVE_BASIS_POINTS / 100}%. Unlocked targets are re-shared around it.`}
          error={reserveError}
          onChange={(value) => {
            setReserveText(value);
            setReserveError(undefined);
          }}
        />
        <Button type="submit" variant="secondary">
          Set reserve
        </Button>
      </form>
    </Card>
  );
}
