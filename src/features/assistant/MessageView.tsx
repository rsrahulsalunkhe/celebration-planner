import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { formatMoney } from '@/domain/money.ts';
import type { ChangePreview } from '@/domain/planning/preview.ts';
import type { SuggestedReply } from '@/services/ai/assistant.ts';
import styles from './Assistant.module.css';
import type { ChatMessage } from './assistantSession.ts';

/**
 * Renders one message. Everything the user typed and everything a provider
 * returned is rendered as React text, never as HTML.
 */

const money = (paise: number) =>
  paise < 0 ? `−${formatMoney(-paise)}` : formatMoney(paise);

export function Chips({
  options,
  onChoose,
  disabled,
  label,
}: {
  options: readonly SuggestedReply[];
  onChoose: (message: string) => void;
  disabled?: boolean;
  label: string;
}) {
  if (options.length === 0) return null;
  return (
    <ul className={styles.chips} aria-label={label}>
      {options.map((o) => (
        <li key={o.message}>
          <button
            type="button"
            className={styles.chip}
            disabled={disabled}
            onClick={() => {
              onChoose(o.message);
            }}
          >
            {o.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PreviewTables({ preview }: { preview: ChangePreview }) {
  const captionId = useId();
  const m = preview.money;
  const rows = [
    ['Budget', m.budgetBefore, m.budgetAfter],
    ['Reserve', m.reserveBefore, m.reserveAfter],
    ['Forecast', m.forecastBefore, m.forecastAfter],
    ['Over the whole budget', m.shortfallBefore, m.shortfallAfter],
    ['Into the reserve', m.gapBefore, m.gapAfter],
  ] as const;
  const { expenses, tasks, conflicts } = preview;
  return (
    <>
      {preview.fieldChanges.length > 0 ? (
        <ul>
          {preview.fieldChanges.map((f) => (
            <li key={f.field}>
              {f.label}: {f.before} → {f.after}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className={styles.tableWrap}
        // Focusable so the table can be scrolled sideways with the keyboard on narrow screens.
        tabIndex={0}
        aria-describedby={captionId}
      >
        <table className={styles.table}>
          <caption id={captionId}>Planner calculation, before and after</caption>
          <thead>
            <tr>
              <th scope="col">Figure</th>
              <th scope="col" className={styles.num}>
                Before
              </th>
              <th scope="col" className={styles.num}>
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, before, after]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className={styles.num}>{money(before)}</td>
                <td className={styles.num}>{money(after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {expenses.added.length + expenses.changed.length + expenses.removed.length > 0 ? (
        <div>
          <p>
            <strong>Costs that change:</strong>
          </p>
          <ul>
            {[...expenses.added, ...expenses.changed, ...expenses.removed]
              .slice(0, 8)
              .map((e) => (
                <li key={e.id}>
                  {e.name}: {formatMoney(e.beforePaise)} → {formatMoney(e.afterPaise)}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {tasks.added.length + tasks.removed.length + tasks.rescheduled.length > 0 ? (
        <div>
          <p>
            <strong>Timeline:</strong> {tasks.added.length} added, {tasks.removed.length}{' '}
            removed, {tasks.rescheduled.length} rescheduled.
          </p>
          {tasks.added.length > 0 ? (
            <ul>
              {tasks.added.slice(0, 5).map((t) => (
                <li key={t.id}>New: {t.title}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {conflicts.introduced.length > 0 ? (
        <div>
          <p>
            <strong>New problems:</strong>
          </p>
          <ul>
            {conflicts.introduced.map((c) => (
              <li key={c.id}>{c.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {conflicts.resolved.length > 0 ? (
        <div>
          <p>
            <strong>Resolved:</strong>
          </p>
          <ul>
            {conflicts.resolved.map((c) => (
              <li key={c.id}>{c.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

interface MessageViewProps {
  message: ChatMessage;
  busy: boolean;
  /** Engine preview for a pending proposal, computed from the current state. */
  preview: ChangePreview | null;
  onSend: (text: string) => void;
  onApply: (messageId: string) => void;
  onDismiss: (messageId: string) => void;
}

export function MessageView({
  message,
  busy,
  preview,
  onSend,
  onApply,
  onDismiss,
}: MessageViewProps) {
  if (message.role === 'user') {
    return (
      <li className={styles.message} data-role="user">
        <span className={styles.who}>You</span>
        <p>{message.text}</p>
      </li>
    );
  }
  if (message.role === 'notice' || message.role === 'error') {
    return (
      <li className={styles.message} data-role={message.role}>
        <span className={styles.who}>
          {message.role === 'error' ? 'Something went wrong' : 'Note'}
        </span>
        <p>{message.text}</p>
        {message.retry ? (
          <div className={styles.buttons}>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (message.retry) onSend(message.retry);
              }}
            >
              Ask again
            </Button>
          </div>
        ) : null}
      </li>
    );
  }

  const { response } = message;
  return (
    <li className={styles.message} data-role="assistant">
      <span className={styles.who}>
        {response.provider.label}
        <Badge>
          {
            {
              question: 'Question',
              info: 'Information',
              draft: 'Draft',
              proposal: 'Proposed change',
            }[response.kind]
          }
        </Badge>
      </span>

      {response.kind === 'question' ? (
        <>
          <p>{response.text}</p>
          <Chips
            label="Possible answers"
            options={response.options}
            onChoose={onSend}
            disabled={busy}
          />
        </>
      ) : null}

      {response.kind === 'info' ? (
        <>
          <h3>{response.title}</h3>
          {response.facts ? (
            <dl className={styles.facts}>
              {response.facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {response.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {response.links && response.links.length > 0 ? (
            <div className={styles.links}>
              {response.links.map((l) => (
                <Link key={l.to + l.label} to={l.to}>
                  {l.label}
                </Link>
              ))}
            </div>
          ) : null}
          {response.suggestions ? (
            <Chips
              label="Try one of these"
              options={response.suggestions}
              onChoose={onSend}
              disabled={busy}
            />
          ) : null}
        </>
      ) : null}

      {response.kind === 'draft' ? (
        <>
          <h3>{response.title}</h3>
          <p>{response.intro}</p>
          <ul>
            {response.items.map((item) => (
              <li key={item.title}>
                <strong>{item.title}.</strong> {item.details}
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{response.note}</p>
        </>
      ) : null}

      {response.kind === 'proposal' ? (
        <>
          <h3>{response.title}</h3>
          <p>{response.explanation}</p>
          {message.problem ? (
            <p>
              <strong>This change cannot be proposed:</strong> {message.problem}
            </p>
          ) : null}
          {message.proposal ? (
            <ProposalBody
              messageId={message.id}
              state={message.proposal.state}
              note={message.proposal.note}
              preview={preview}
              busy={busy}
              askedWith={message.askedWith}
              onSend={onSend}
              onApply={onApply}
              onDismiss={onDismiss}
            />
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function ProposalBody({
  messageId,
  state,
  note,
  preview,
  busy,
  askedWith,
  onSend,
  onApply,
  onDismiss,
}: {
  messageId: string;
  state: 'pending' | 'applied' | 'dismissed';
  note: string | undefined;
  preview: ChangePreview | null;
  busy: boolean;
  askedWith: string;
  onSend: (text: string) => void;
  onApply: (messageId: string) => void;
  onDismiss: (messageId: string) => void;
}) {
  if (state === 'applied') {
    return (
      <p>
        <strong>Applied.</strong> {note}
      </p>
    );
  }
  if (state === 'dismissed') {
    return <p className={styles.muted}>Dismissed. Nothing was changed.</p>;
  }
  if (preview?.status !== 'ok') {
    return (
      <div className={styles.preview}>
        <p>
          {preview?.status === 'stale'
            ? 'The event has changed since this was proposed, so it cannot be applied as it is.'
            : (preview?.reasons[0] ?? 'This proposal can no longer be applied.')}
        </p>
        {note ? <p>{note}</p> : null}
        <div className={styles.buttons}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              onSend(askedWith);
            }}
          >
            Ask again with the current event
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.preview}>
      <PreviewTables preview={preview} />
      {note ? <p role="alert">{note}</p> : null}
      <div className={styles.buttons}>
        <Button
          onClick={() => {
            onApply(messageId);
          }}
        >
          Apply change
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onDismiss(messageId);
          }}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
