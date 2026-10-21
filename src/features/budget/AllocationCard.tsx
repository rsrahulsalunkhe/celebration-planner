import { Lock, LockOpen, Pencil, Scale } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { TextField } from '@/components/TextField.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatMoney, formatMoneyInput } from '@/domain/money.ts';
import {
  rebalanceTargets,
  setTargetEdit,
  unlockTargetEdit,
  type BudgetLedger,
  type RebalanceResult,
} from '@/domain/planning/budget.ts';
import type { EventRecord } from '@/domain/types.ts';
import styles from './Budget.module.css';
import { money, signedMoney, type Commit, type Report } from './budgetFormat.ts';
import { readAmount } from './expenseForm.ts';

const CONFIG = PLANNING_CONFIGURATION;

function rebalanceNote(rebalance: RebalanceResult): string {
  const moved = rebalance.changes.length;
  const parts = [
    moved > 0
      ? `${moved} unlocked ${moved === 1 ? 'target was' : 'targets were'} re-shared.`
      : 'No unlocked target needed to move.',
  ];
  if (rebalance.excessPaise > 0) {
    parts.push(
      `Locked targets are ${formatMoney(rebalance.excessPaise)} more than the money left after the reserve. Nothing was unlocked; edit or unlock a target.`,
    );
  } else if (rebalance.unallocatedPaise > 0) {
    parts.push(
      `${formatMoney(rebalance.unallocatedPaise)} is not allocated to any category.`,
    );
  }
  return parts.join(' ');
}

/** Target beside forecast for each category. Decorative: the table has the same figures. */
function AllocationBars({ ledger }: { ledger: BudgetLedger }) {
  const scale = Math.max(
    0,
    ...ledger.categories.map((c) => Math.max(c.targetPaise, c.forecastPaise)),
  );
  if (scale === 0) return null;
  const width = (paise: number) => `${((paise / scale) * 100).toFixed(2)}%`;
  return (
    <figure className={styles.figure}>
      <figcaption>
        Target and forecast by category. Exact figures are in the table below.
      </figcaption>
      <ul className={styles.legend} aria-hidden="true">
        <li>
          <span className={`${styles.swatch} ${styles.targets}`} />
          Target
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.forecastFill}`} />
          Forecast
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.over}`} />
          Forecast above target
        </li>
      </ul>
      <ul className={styles.bars} aria-hidden="true">
        {ledger.categories.map((c) => (
          <li key={c.id} className={styles.barRow}>
            <span className={styles.barName}>{c.name}</span>
            <span className={styles.barPair}>
              <span
                className={`${styles.bar} ${styles.targets}`}
                data-empty={c.targetPaise === 0}
                style={{ width: width(c.targetPaise) }}
                title={`Target ${formatMoney(c.targetPaise)}`}
              />
              <span
                className={`${styles.bar} ${c.forecastPaise > c.targetPaise ? styles.over : styles.forecastFill}`}
                data-empty={c.forecastPaise === 0}
                style={{ width: width(c.forecastPaise) }}
                title={`Forecast ${formatMoney(c.forecastPaise)}`}
              />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function AllocationCard({
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetText, setTargetText] = useState('');
  const [targetError, setTargetError] = useState<string | undefined>();
  const editing = ledger.categories.find((c) => c.id === editingId) ?? null;
  const pending = rebalanceTargets(event, CONFIG);

  useEffect(() => {
    if (editingId) document.getElementById('field-category-target')?.focus();
  }, [editingId]);

  const saveTarget = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!editing) return;
    const read = readAmount(targetText, '50000');
    if ('error' in read) {
      setTargetError(read.error);
      document.getElementById('field-category-target')?.focus();
      return;
    }
    const edit = setTargetEdit(event, CONFIG, editing.id, read.paise);
    if (!edit.ok) {
      setTargetError(edit.issues[0]);
      return;
    }
    if (
      commit(
        edit.operations,
        `${editing.name} target set to ${formatMoney(read.paise)} and locked. ${rebalanceNote(edit.rebalance)}`,
      )
    ) {
      setEditingId(null);
      document.getElementById(`edit-target-${editing.id}`)?.focus();
    }
  };

  const totals = {
    forecast: ledger.forecastPaise,
    committed: ledger.committedPaise,
    paid: ledger.paidPaise,
    outstanding: ledger.outstandingPaise,
  };

  return (
    <Card
      title="Category targets"
      description="Targets are spending goals, separate from what things are forecast to cost. A target you set is locked; only unlocked targets are re-shared."
      actions={
        pending.operations.length > 0 ? (
          <Button
            variant="secondary"
            icon={<Scale aria-hidden size={18} />}
            onClick={() => {
              commit(pending.operations, `Rebalanced. ${rebalanceNote(pending)}`);
            }}
          >
            Rebalance unlocked targets
          </Button>
        ) : null
      }
    >
      {ledger.allLocked && ledger.allocationState !== 'balanced' ? (
        <p className={styles.note}>
          Every target is locked, so nothing can be re-shared automatically.{' '}
          {ledger.allocationState === 'unallocated'
            ? `${formatMoney(ledger.allocationDifferencePaise)} is not allocated.`
            : `Targets are ${formatMoney(-ledger.allocationDifferencePaise)} more than the money left after the reserve.`}{' '}
          Edit or unlock a target to fix this.
        </p>
      ) : null}

      <AllocationBars ledger={ledger} />

      <div
        className={styles.tableWrap}
        role="region"
        aria-labelledby="allocation-caption"
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption id="allocation-caption">
            Targets, forecast, agreed, paid and outstanding
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className={styles.num}>
                Target
              </th>
              <th scope="col">Target status</th>
              <th scope="col" className={styles.num}>
                Forecast
              </th>
              <th scope="col" className={styles.num}>
                Agreed
              </th>
              <th scope="col" className={styles.num}>
                Paid
              </th>
              <th scope="col" className={styles.num}>
                Outstanding
              </th>
              <th scope="col" className={styles.num}>
                Target − forecast
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.categories.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  {c.name}
                  {c.requiredFloorPaise > 0 ? (
                    <span className={styles.detail}>
                      Includes required provisions of {formatMoney(c.requiredFloorPaise)}
                    </span>
                  ) : null}
                </th>
                <td className={styles.num}>{formatMoney(c.targetPaise)}</td>
                <td>
                  <span className={styles.cellStack}>
                    {c.locked ? (
                      <Badge tone="navy">
                        <Lock aria-hidden size={12} /> Locked
                      </Badge>
                    ) : c.weighted ? (
                      <Badge>Shared by weight</Badge>
                    ) : (
                      <Badge>Kept as is</Badge>
                    )}
                    <Button
                      id={`edit-target-${c.id}`}
                      variant="ghost"
                      icon={<Pencil aria-hidden size={14} />}
                      aria-label={`Edit target for ${c.name}`}
                      onClick={() => {
                        setEditingId(c.id);
                        setTargetText(formatMoneyInput(c.targetPaise));
                        setTargetError(undefined);
                      }}
                    >
                      Edit
                    </Button>
                    {c.locked && c.weighted ? (
                      <Button
                        variant="ghost"
                        icon={<LockOpen aria-hidden size={14} />}
                        aria-label={`Unlock ${c.name}`}
                        onClick={() => {
                          const edit = unlockTargetEdit(event, CONFIG, c.id);
                          if (!edit.ok) {
                            report(edit.issues[0] ?? 'Could not unlock.', 'error');
                            return;
                          }
                          commit(
                            edit.operations,
                            `${c.name} unlocked and shared by weight again. ${rebalanceNote(edit.rebalance)}`,
                          );
                        }}
                      >
                        Unlock
                      </Button>
                    ) : null}
                  </span>
                </td>
                <td className={styles.num}>{formatMoney(c.forecastPaise)}</td>
                <td className={styles.num}>{formatMoney(c.committedPaise)}</td>
                <td className={styles.num}>{formatMoney(c.paidPaise)}</td>
                <td className={styles.num}>{formatMoney(c.outstandingPaise)}</td>
                <td
                  className={`${styles.num} ${c.targetLeftPaise < 0 ? styles.negative : ''}`}
                >
                  {signedMoney(c.targetLeftPaise)}
                  {c.targetLeftPaise < 0 ? (
                    <span className={styles.detail}>over target</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All categories</th>
              <td className={styles.num}>{formatMoney(ledger.targetsPaise)}</td>
              <td>
                {formatMoney(ledger.lockedTargetsPaise)} locked,{' '}
                {formatMoney(ledger.unlockedTargetsPaise)} unlocked
              </td>
              <td className={styles.num}>{formatMoney(totals.forecast)}</td>
              <td className={styles.num}>{formatMoney(totals.committed)}</td>
              <td className={styles.num}>{formatMoney(totals.paid)}</td>
              <td className={styles.num}>{formatMoney(totals.outstanding)}</td>
              <td className={styles.num}>
                {signedMoney(ledger.targetsPaise - ledger.forecastPaise)}
              </td>
            </tr>
            <tr>
              <th scope="row">Reserve (not an expense)</th>
              <td className={styles.num}>{formatMoney(ledger.reservePaise)}</td>
              <td colSpan={6} />
            </tr>
            <tr>
              <th scope="row">
                {ledger.allocationState === 'over-allocated'
                  ? 'Targets over the budget'
                  : 'Not allocated'}
              </th>
              <td
                className={`${styles.num} ${ledger.allocationState === 'over-allocated' ? styles.negative : ''}`}
              >
                {money(Math.abs(ledger.allocationDifferencePaise))}
              </td>
              <td colSpan={6} />
            </tr>
            <tr>
              <th scope="row">Budget</th>
              <td className={styles.num}>{formatMoney(ledger.budgetPaise)}</td>
              <td colSpan={6}>Headroom after forecast: {money(ledger.headroomPaise)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editing ? (
        <form
          className={`${styles.section} ${styles.inline}`}
          onSubmit={saveTarget}
          noValidate
          aria-label={`Set target for ${editing.name}`}
        >
          <TextField
            name="category-target"
            label={`Target for ${editing.name}, in rupees`}
            value={targetText}
            inputMode="decimal"
            hint="Saving locks this target. The other unlocked targets share what is left."
            error={targetError}
            onChange={(value) => {
              setTargetText(value);
              setTargetError(undefined);
            }}
          />
          <div className={styles.buttons}>
            <Button type="submit">Save and lock</Button>
            <Button
              variant="secondary"
              onClick={() => {
                const id = editing.id;
                setEditingId(null);
                document.getElementById(`edit-target-${id}`)?.focus();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
