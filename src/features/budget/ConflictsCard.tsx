import { Card } from '@/components/Card.tsx';
import type { BudgetLedger } from '@/domain/planning/budget.ts';
import type { Conflict } from '@/domain/planning/types.ts';
import styles from './Budget.module.css';
import { SEVERITY_LABELS } from './budgetFormat.ts';

const ORDER = { blocking: 0, critical: 1, warning: 2, info: 3 } as const;

export function ConflictList({ conflicts }: { conflicts: readonly Conflict[] }) {
  return (
    <ul className={styles.conflicts}>
      {[...conflicts]
        .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
        .map((c) => (
          <li key={c.id} className={styles.conflict} data-severity={c.severity}>
            <span className={styles.conflictLabel}>{SEVERITY_LABELS[c.severity]}:</span>{' '}
            {c.message}
          </li>
        ))}
    </ul>
  );
}

/**
 * Everything that does not add up, in plain words, with the ways to close a
 * gap. Nothing here is hidden when the budget cannot work: a shortfall stays
 * on screen until costs, guests or the budget change.
 */
export function ConflictsCard({ ledger }: { ledger: BudgetLedger }) {
  // Per-category overruns are shown in the allocation table instead.
  const conflicts = ledger.conflicts.filter((c) => c.kind !== 'category-over-target');
  return (
    <Card
      title="Checks"
      description={
        ledger.reconciles
          ? 'All totals reconcile: forecast, agreed, paid, outstanding, reserve and headroom add up exactly.'
          : 'Some totals do not reconcile. Check the items marked below.'
      }
    >
      {conflicts.length === 0 ? (
        <p>
          Nothing needs attention. The forecast fits inside the budget after the reserve.
        </p>
      ) : (
        <ConflictList conflicts={conflicts} />
      )}
      {ledger.options.length > 0 ? (
        <div className={styles.section}>
          <h3>Ways to close the gap</h3>
          <ul className={styles.list}>
            {ledger.options.map((o) => (
              <li key={o.id}>{o.description}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
