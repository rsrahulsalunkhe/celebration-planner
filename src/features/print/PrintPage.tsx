import { ArrowLeft, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { useCalendar } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { ButtonLink } from '@/components/ButtonLink.tsx';
import {
  ACCESSIBILITY_LABELS,
  DIETARY_LABELS,
  EVENT_TYPE_LABELS,
  PRIORITY_LABELS,
  SETTING_LABELS,
  TASK_STATUS_LABELS,
  VENDOR_STATUS_LABELS,
} from '@/data/labels.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { SAMPLE_VENDORS } from '@/data/sampleVendors.ts';
import { daysBetween, formatDate } from '@/domain/dates.ts';
import { formatMoney } from '@/domain/money.ts';
import { buildLedger } from '@/domain/planning/budget.ts';
import { SOURCE_LABELS, sourceOf } from '@/domain/planning/ideas.ts';
import { PHASE_LABELS, PLANNING_PHASES, phaseOf } from '@/domain/planning/timeline.ts';
import {
  VENDOR_KIND_LABELS,
  linkedExpense,
  vendorChecklist,
} from '@/domain/planning/vendors.ts';
import type { EventRecord } from '@/domain/types.ts';
import styles from './Print.module.css';

const CONFIG = PLANNING_CONFIGURATION;
const money = (paise: number) => formatMoney(paise);
const listOr = (items: readonly string[], none: string) =>
  items.length > 0 ? items.join(', ') : none;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * The whole plan on paper: summary, assumptions, budget, checklist, vendor
 * confirmations, chosen ideas and running order. Printed with the browser's
 * own print dialog (which also saves as PDF); the app frame and buttons are
 * hidden and tables are allowed to break between rows, never within them.
 */
function PrintablePlan({ event }: { event: EventRecord }) {
  const today = useCalendar().today();
  const { profile, preferences } = event;
  const ledger = buildLedger(event, CONFIG);
  const categoryName = new Map(ledger.categories.map((c) => [c.id, c.name]));
  const days = daysBetween(today, profile.date);
  const tasks = [...event.tasks].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title),
  );
  const done = tasks.filter((t) => t.status === 'done').length;
  const chosen = event.ideas.filter((i) => i.favorite === true || i.taskId !== undefined);
  const otherIdeas = event.ideas.length - chosen.length;

  return (
    <article className={styles.page}>
      <div className={`${styles.toolbar} no-print`}>
        <ButtonLink
          variant="secondary"
          to="/data"
          icon={<ArrowLeft aria-hidden size={18} />}
        >
          Back to your data
        </ButtonLink>
        <Button
          icon={<Printer aria-hidden size={18} />}
          onClick={() => {
            window.print();
          }}
        >
          Print or save as PDF
        </Button>
        <p className={styles.hint}>
          To keep a PDF, choose “Save as PDF” as the printer in the print dialog.
        </p>
      </div>

      <header className={styles.header}>
        <h1 tabIndex={-1}>{profile.title}</h1>
        <p>
          {EVENT_TYPE_LABELS[profile.eventType]} · {formatDate(profile.date)} ·{' '}
          {profile.city} · {profile.guestCount.toString()} guests ·{' '}
          {SETTING_LABELS[profile.setting]}
        </p>
        <p className={styles.meta}>
          Plan printed {formatDate(today)} from Celebration Planner.
          {profile.demoPresetId ? ' This is a fictional demonstration event.' : ''}
        </p>
      </header>

      <Section title="Summary">
        <dl className={styles.facts}>
          <div>
            <dt>Event</dt>
            <dd>
              {days > 0
                ? `In ${days.toString()} days`
                : days === 0
                  ? 'Today'
                  : `${(-days).toString()} days ago`}
            </dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd>{money(ledger.budgetPaise)}</dd>
          </div>
          <div>
            <dt>Forecast spend</dt>
            <dd>{money(ledger.forecastPaise)}</dd>
          </div>
          <div>
            <dt>
              {ledger.headroomPaise >= 0
                ? 'Left after reserve'
                : 'Over the spendable amount'}
            </dt>
            <dd>{money(Math.abs(ledger.headroomPaise))}</dd>
          </div>
          <div>
            <dt>Agreed with vendors</dt>
            <dd>{money(ledger.committedPaise)}</dd>
          </div>
          <div>
            <dt>Paid / still to pay</dt>
            <dd>
              {money(ledger.paidPaise)} / {money(ledger.outstandingPaise)}
            </dd>
          </div>
          <div>
            <dt>Tasks done</dt>
            <dd>
              {done.toString()} of {tasks.length.toString()}
            </dd>
          </div>
          <div>
            <dt>Vendors booked</dt>
            <dd>
              {event.vendors.filter((v) => v.status === 'booked').length.toString()} of{' '}
              {event.vendors.length.toString()}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Assumptions">
        <ul className={styles.bullets}>
          <li>
            Guest count {profile.guestCount.toString()}; per-guest costs use this number.
          </li>
          <li>
            Reserve kept aside: {(ledger.reserveBasisPoints / 100).toString()}% (
            {money(ledger.reservePaise)})
            {ledger.reserveIsDefault ? ', the planner’s default' : ''}. Spendable:{' '}
            {money(ledger.spendablePaise)}.
          </li>
          <li>
            Priorities:{' '}
            {listOr(
              preferences.priorities.map((p) => PRIORITY_LABELS[p]),
              'none chosen',
            )}
            .
          </li>
          <li>
            Dietary needs:{' '}
            {listOr(
              preferences.dietaryNeeds.map((d) => DIETARY_LABELS[d]),
              'none listed',
            )}
            {preferences.dietaryNotes ? `. ${preferences.dietaryNotes}` : ''}.
          </li>
          <li>
            Accessibility needs:{' '}
            {listOr(
              preferences.accessibilityNeeds.map((a) => ACCESSIBILITY_LABELS[a]),
              'none listed',
            )}
            {preferences.accessibilityNotes ? `. ${preferences.accessibilityNotes}` : ''}.
          </li>
          {preferences.culturalPreferences.length > 0 && (
            <li>Cultural preferences: {preferences.culturalPreferences.join(', ')}.</li>
          )}
          <li>{CONFIG.ratesDisclosure}</li>
        </ul>
      </Section>

      <Section title="Budget">
        {ledger.items.length === 0 ? (
          <p>No budget lines yet.</p>
        ) : (
          <>
            <div
              className={styles.tableWrap}
              role="region"
              aria-label="Budget by category"
              tabIndex={0}
            >
              <table className={`${styles.table} ${styles.money}`}>
                <caption>By category</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Target</th>
                    <th scope="col">Forecast</th>
                    <th scope="col">Agreed</th>
                    <th scope="col">Paid</th>
                    <th scope="col">To pay</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.categories.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">
                        {c.name}
                        {c.locked ? ' (locked)' : ''}
                      </th>
                      <td>{money(c.targetPaise)}</td>
                      <td>{money(c.forecastPaise)}</td>
                      <td>{money(c.committedPaise)}</td>
                      <td>{money(c.paidPaise)}</td>
                      <td>{money(c.outstandingPaise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td>{money(ledger.targetsPaise)}</td>
                    <td>{money(ledger.forecastPaise)}</td>
                    <td>{money(ledger.committedPaise)}</td>
                    <td>{money(ledger.paidPaise)}</td>
                    <td>{money(ledger.outstandingPaise)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div
              className={styles.tableWrap}
              role="region"
              aria-label="Budget lines"
              tabIndex={0}
            >
              <table className={`${styles.table} ${styles.money}`}>
                <caption>Budget lines</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Category</th>
                    <th scope="col">Forecast</th>
                    <th scope="col">Based on</th>
                    <th scope="col">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.items.map((item) => (
                    <tr key={item.expenseId}>
                      <th scope="row">{item.name}</th>
                      <td>{categoryName.get(item.categoryId) ?? ''}</td>
                      <td>{money(item.forecastPaise)}</td>
                      <td>
                        {item.basis === 'commitment' ? 'Agreed amount' : 'Estimate'}
                      </td>
                      <td>{money(item.paidPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section title="Checklist">
        {tasks.length === 0 ? (
          <p>No tasks yet.</p>
        ) : (
          PLANNING_PHASES.map((phase) => {
            const inPhase = tasks.filter((t) => phaseOf(t, profile.date) === phase);
            if (inPhase.length === 0) return null;
            return (
              <div key={phase} className={styles.group}>
                <h3>{PHASE_LABELS[phase]}</h3>
                <ul className={styles.checklist}>
                  {inPhase.map((t) => (
                    <li key={t.id}>
                      <span aria-hidden className={styles.box}>
                        {t.status === 'done' ? '☑' : '☐'}
                      </span>
                      <span>
                        <strong>{t.title}</strong> — due {formatDate(t.dueDate)} ·{' '}
                        {TASK_STATUS_LABELS[t.status]}
                        {t.owner ? ` · ${t.owner}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </Section>

      <Section title="Vendor confirmations">
        {event.vendors.length === 0 ? (
          <p>No vendors recorded yet.</p>
        ) : (
          event.vendors.map((v) => {
            const sample = SAMPLE_VENDORS.find((s) => s.id === v.sampleId) ?? null;
            const checks = vendorChecklist(event, v.kind, CONFIG, sample);
            const ticked = new Set(v.checksDone ?? []);
            const expense = linkedExpense(event, v.id);
            return (
              <div key={v.id} className={styles.group}>
                <h3>
                  {v.name} — {VENDOR_KIND_LABELS[v.kind]},{' '}
                  {VENDOR_STATUS_LABELS[v.status]}
                </h3>
                <p>
                  {v.contact ? `Contact: ${v.contact}. ` : ''}
                  {expense?.commitment
                    ? `Agreed and linked to the budget line “${expense.name}”.`
                    : v.quotePaise !== null
                      ? `Latest quote ${money(v.quotePaise)}, not yet agreed.`
                      : 'No quote yet.'}
                  {sample ? ' Sample vendor: its details are fictional.' : ''}
                </p>
                <p className={styles.meta}>
                  {ticked.size.toString()} of {checks.length.toString()} questions checked
                  by you; nothing here is verified by the app.
                </p>
                <ul className={styles.checklist}>
                  {checks.map((q) => (
                    <li key={q.id}>
                      <span aria-hidden className={styles.box}>
                        {ticked.has(q.id) ? '☑' : '☐'}
                      </span>
                      <span>
                        {q.text}
                        <span className={styles.srOnly}>
                          {ticked.has(q.id) ? ' (checked)' : ' (not checked)'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </Section>

      <Section title="Chosen ideas">
        {chosen.length === 0 ? (
          <p>No ideas favourited or added to the checklist yet.</p>
        ) : (
          <ul className={styles.bullets}>
            {chosen.map((i) => (
              <li key={i.id}>
                <strong>{i.title}</strong> ({SOURCE_LABELS[sourceOf(i)]}
                {i.favorite ? ', favourite' : ''}
                {i.taskId ? ', on the checklist' : ''}){i.details ? `: ${i.details}` : ''}
              </li>
            ))}
          </ul>
        )}
        {otherIdeas > 0 && (
          <p className={styles.meta}>
            {otherIdeas.toString()} other saved{' '}
            {otherIdeas === 1 ? 'idea is' : 'ideas are'} not printed.
          </p>
        )}
      </Section>

      <Section title="Running order">
        {event.runOrder.length === 0 ? (
          <p>No running order yet.</p>
        ) : (
          <div
            className={styles.tableWrap}
            role="region"
            aria-label="Running order"
            tabIndex={0}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">What</th>
                  <th scope="col">Who</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[...event.runOrder]
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.start}–{r.end}
                      </td>
                      <th scope="row">{r.title}</th>
                      <td>{r.owner ?? ''}</td>
                      <td>{r.notes ?? ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </article>
  );
}

export function PrintPage() {
  return (
    <ActiveEventGate title="Printable plan">
      {(event) => <PrintablePlan event={event} />}
    </ActiveEventGate>
  );
}
