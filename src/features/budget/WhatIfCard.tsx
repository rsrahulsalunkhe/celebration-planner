import { Check, Eye, RefreshCw, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { toOptions } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import { TextField } from '@/components/TextField.tsx';
import { PRIORITY_LABELS } from '@/data/labels.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatMoney } from '@/domain/money.ts';
import {
  SCENARIO_DEFAULTS,
  isPreviewCurrent,
  previewScenario,
  type BudgetScenario,
  type ScenarioMetric,
  type ScenarioPreview,
} from '@/domain/planning/scenarios.ts';
import type { EventRecord, Priority } from '@/domain/types.ts';
import styles from './Budget.module.css';
import { money, signedMoney, type Commit, type Report } from './budgetFormat.ts';
import { ConflictList } from './ConflictsCard.tsx';
import { readPercent } from './expenseForm.ts';

const CONFIG = PLANNING_CONFIGURATION;
const PRIORITY_OPTIONS = toOptions(PRIORITY_LABELS);

const show = (m: ScenarioMetric, value: number) =>
  m.money ? money(value) : String(value);
const change = (m: ScenarioMetric) => {
  const delta = m.after - m.before;
  if (delta === 0) return 'No change';
  return m.money ? signedMoney(delta) : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
};

/**
 * What-if scenarios. A preview is computed from the saved event and kept only
 * in this component; nothing is saved until Apply. Apply is refused (and the
 * preview marked out of date) if the event changed since the preview was made.
 */
export function WhatIfCard({
  event,
  commit,
  report,
}: {
  event: EventRecord;
  commit: Commit;
  report: Report;
}) {
  const [preview, setPreview] = useState<ScenarioPreview | null>(null);
  const [reserveText, setReserveText] = useState('');
  const [reserveError, setReserveError] = useState<string | undefined>();
  const [priority, setPriority] = useState<Priority | ''>(
    event.preferences.priorities[0] ?? '',
  );
  const [priorityError, setPriorityError] = useState<string | undefined>();

  useEffect(() => {
    if (preview) document.getElementById('scenario-preview-heading')?.focus();
  }, [preview]);

  const run = (scenario: BudgetScenario) => {
    setPreview(previewScenario(event, scenario, CONFIG));
  };

  const previewReserve = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const read = readPercent(reserveText);
    if ('error' in read) {
      setReserveError(read.error);
      document.getElementById('field-scenario-reserve')?.focus();
      return;
    }
    run({ kind: 'set-reserve', basisPoints: read.basisPoints });
  };

  const previewPriority = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!priority) {
      setPriorityError('Choose a priority');
      document.getElementById('field-scenario-priority')?.focus();
      return;
    }
    run({
      kind: 'prioritise',
      priority,
      percent: SCENARIO_DEFAULTS.priorityBoostPercent,
    });
  };

  const current = preview ? isPreviewCurrent(preview, event) : false;

  return (
    <Card
      title="What if?"
      description="Preview a change before deciding. A preview changes nothing; Apply saves it, Discard throws it away. Agreed costs, payments, completed tasks and your own records are never changed by a scenario."
    >
      <div className={styles.scenarioGrid}>
        <div className={styles.scenario}>
          <h3>Reduce the budget by {SCENARIO_DEFAULTS.budgetCutPercent}%</h3>
          <p className={styles.muted}>
            From {formatMoney(event.profile.budgetPaise)}. Unlocked targets shrink; locked
            ones stay.
          </p>
          <Button
            variant="secondary"
            icon={<Eye aria-hidden size={18} />}
            onClick={() => {
              run({ kind: 'reduce-budget', percent: SCENARIO_DEFAULTS.budgetCutPercent });
            }}
          >
            Preview budget cut
          </Button>
        </div>
        <div className={styles.scenario}>
          <h3>Increase guests by {SCENARIO_DEFAULTS.guestIncreasePercent}%</h3>
          <p className={styles.muted}>
            From {event.profile.guestCount}. Per-guest items scale; fixed amounts do not.
          </p>
          <Button
            variant="secondary"
            icon={<Eye aria-hidden size={18} />}
            onClick={() => {
              run({
                kind: 'increase-guests',
                percent: SCENARIO_DEFAULTS.guestIncreasePercent,
              });
            }}
          >
            Preview more guests
          </Button>
        </div>
        <form className={styles.scenario} onSubmit={previewReserve} noValidate>
          <h3>Change the reserve</h3>
          <TextField
            name="scenario-reserve"
            label="New reserve, % of budget"
            value={reserveText}
            inputMode="decimal"
            error={reserveError}
            onChange={(v) => {
              setReserveText(v);
              setReserveError(undefined);
            }}
          />
          <Button type="submit" variant="secondary" icon={<Eye aria-hidden size={18} />}>
            Preview reserve
          </Button>
        </form>
        <form className={styles.scenario} onSubmit={previewPriority} noValidate>
          <h3>Give a priority {SCENARIO_DEFAULTS.priorityBoostPercent}% more</h3>
          <Select
            name="scenario-priority"
            label="Priority"
            value={priority}
            options={PRIORITY_OPTIONS}
            placeholder="Choose a priority"
            error={priorityError}
            onChange={(v) => {
              setPriority(v);
              setPriorityError(undefined);
            }}
          />
          <Button type="submit" variant="secondary" icon={<Eye aria-hidden size={18} />}>
            Preview priority
          </Button>
        </form>
      </div>

      {preview ? (
        <section className={styles.preview} aria-labelledby="scenario-preview-heading">
          <h3 id="scenario-preview-heading" tabIndex={-1}>
            Preview: {preview.title}
          </h3>
          {!current ? (
            <div className={`${styles.note} ${styles.section}`}>
              <p>
                <strong>This preview is out of date.</strong> The budget changed after it
                was made, so it cannot be applied. Preview it again from the current plan.
              </p>
            </div>
          ) : null}
          {preview.status !== 'ok' ? (
            <ul className={`${styles.list} ${styles.section}`}>
              {preview.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <PreviewDetails preview={preview} />
          )}
          <div className={`${styles.buttons} ${styles.section}`}>
            {current && preview.status === 'ok' ? (
              <Button
                icon={<Check aria-hidden size={18} />}
                onClick={() => {
                  if (
                    commit(
                      preview.operations,
                      `Applied: ${preview.title}.${preview.after && preview.after.shortfallPaise > 0 ? ` The plan is ${formatMoney(preview.after.shortfallPaise)} over the whole budget; see Checks.` : ''}`,
                    )
                  ) {
                    setPreview(null);
                  }
                }}
              >
                Apply
              </Button>
            ) : null}
            {!current ? (
              <Button
                variant="secondary"
                icon={<RefreshCw aria-hidden size={18} />}
                onClick={() => {
                  run(preview.scenario);
                }}
              >
                Preview again
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon={<X aria-hidden size={18} />}
              onClick={() => {
                setPreview(null);
                report('Discarded the preview. Nothing was changed.', 'info');
              }}
            >
              Discard
            </Button>
          </div>
        </section>
      ) : null}
    </Card>
  );
}

function PreviewDetails({ preview }: { preview: ScenarioPreview }) {
  const { conflicts } = preview;
  return (
    <>
      <div
        className={styles.tableWrap}
        role="region"
        aria-labelledby="scenario-metrics-caption"
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption id="scenario-metrics-caption">Before and after</caption>
          <thead>
            <tr>
              <th scope="col">Figure</th>
              <th scope="col" className={styles.num}>
                Before
              </th>
              <th scope="col" className={styles.num}>
                After
              </th>
              <th scope="col" className={styles.num}>
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.metrics.map((m) => (
              <tr key={m.key}>
                <th scope="row">{m.label}</th>
                <td className={styles.num}>{show(m, m.before)}</td>
                <td
                  className={`${styles.num} ${(m.key === 'headroom' && m.after < 0) || (m.key === 'shortfall' && m.after > 0) ? styles.negative : ''}`}
                >
                  {show(m, m.after)}
                </td>
                <td className={styles.num}>{change(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.section}>
        <h4>Trade-offs</h4>
        <ul className={styles.list}>
          {preview.tradeOffs.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      <div className={styles.section}>
        <h4>Changed target recommendations</h4>
        {preview.targetChanges.length === 0 ? (
          <p className={styles.muted}>No category target changes.</p>
        ) : (
          <div
            className={styles.tableWrap}
            role="region"
            aria-labelledby="scenario-targets-caption"
            tabIndex={0}
          >
            <table className={styles.table}>
              <caption id="scenario-targets-caption">
                Category targets before and after
              </caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className={styles.num}>
                    Before
                  </th>
                  <th scope="col" className={styles.num}>
                    After
                  </th>
                  <th scope="col" className={styles.num}>
                    Change
                  </th>
                  <th scope="col">After applying</th>
                </tr>
              </thead>
              <tbody>
                {preview.targetChanges.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td className={styles.num}>{formatMoney(c.beforePaise)}</td>
                    <td className={styles.num}>{formatMoney(c.afterPaise)}</td>
                    <td className={styles.num}>
                      {signedMoney(c.afterPaise - c.beforePaise)}
                    </td>
                    <td>
                      {c.locked ? <Badge tone="navy">Locked</Badge> : 'Shared by weight'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview.recommendations.length > 0 ? (
        <div className={styles.section}>
          <h4>Changed suggestions for closing a gap</h4>
          <ul className={styles.list}>
            {preview.recommendations.map((r) => (
              <li key={r.id}>
                {r.after === null
                  ? `No longer needed: ${r.before ?? ''}`
                  : r.before === null
                    ? `New: ${r.after}`
                    : `Now: ${r.after}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflicts.introduced.length > 0 || conflicts.resolved.length > 0 ? (
        <div className={styles.section}>
          <h4>Checks that change</h4>
          {conflicts.introduced.length > 0 ? (
            <>
              <p>New after applying:</p>
              <ConflictList conflicts={conflicts.introduced} />
            </>
          ) : null}
          {conflicts.resolved.length > 0 ? (
            <>
              <p className={styles.section}>Resolved by applying:</p>
              <ConflictList conflicts={conflicts.resolved} />
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
