import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { TextField } from '@/components/TextField.tsx';
import { formatDate } from '@/domain/dates.ts';
import { createId } from '@/domain/ids.ts';
import { buildRunOrder, formatDuration } from '@/domain/planning/runOrder.ts';
import { LIMITS } from '@/domain/primitives.ts';
import type { ChangeOperation, EventRecord, RunOrderItem } from '@/domain/types.ts';
import styles from './Timeline.module.css';
import {
  parseRunOrderForm,
  valuesFromRunOrder,
  type RunOrderErrors,
  type RunOrderField,
  type RunOrderFormValues,
} from './taskForm.ts';

type Commit = (operations: readonly ChangeOperation[], success: string) => boolean;
type Mode = { kind: 'add' } | { kind: 'edit'; id: string } | null;

/**
 * The event-day running order. Items are always listed by start time, so an
 * item is moved by changing its times in the form; there is no dragging.
 */
export function RunOrderCard({ event, commit }: { event: EventRecord; commit: Commit }) {
  const [mode, setMode] = useState<Mode>(null);
  const order = buildRunOrder(event.runOrder);
  const editing =
    mode?.kind === 'edit' ? (event.runOrder.find((i) => i.id === mode.id) ?? null) : null;
  const atLimit = event.runOrder.length >= LIMITS.runOrder;

  const close = (focusId: string) => {
    setMode(null);
    setTimeout(() => {
      document.getElementById(focusId)?.focus();
    }, 0);
  };

  return (
    <Card
      title="Event-day running order"
      description={`Local times on ${formatDate(event.profile.date)}. Items are listed by start time; to move one, change its times.`}
      actions={
        <Button
          id="add-run-item"
          icon={<Plus aria-hidden size={18} />}
          disabled={atLimit}
          onClick={() => {
            setMode({ kind: 'add' });
          }}
        >
          Add item
        </Button>
      }
    >
      {order.overlaps.length > 0 ? (
        <ul className={styles.messages}>
          {order.overlaps.map((o) => (
            <li key={`${o.a}-${o.b}`} data-tone="warning">
              <strong>Overlap:</strong> {o.message}
            </li>
          ))}
        </ul>
      ) : null}
      {order.rows.length === 0 ? (
        <p className={styles.muted}>
          No items yet. Add the first one with a start and end time.
        </p>
      ) : (
        <div
          className={styles.tableWrap}
          role="region"
          aria-labelledby="run-order-caption"
          tabIndex={0}
        >
          <table className={styles.table}>
            <caption id="run-order-caption">
              {order.span
                ? `From ${order.span.start} to ${order.span.end}`
                : 'Running order'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Item</th>
                <th scope="col">Length</th>
                <th scope="col">Who</th>
                <th scope="col">Notes</th>
                <th scope="col">
                  <span className="srOnly">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {order.rows.map((row) => (
                <tr key={row.item.id}>
                  <td className={styles.nowrap}>
                    {row.item.start}–{row.item.end}
                  </td>
                  <th scope="row">
                    {row.item.title}
                    {row.overlapsWith.length > 0 ? (
                      <>
                        {' '}
                        <Badge tone="coral">
                          Overlaps {row.overlapsWith.map((o) => o.title).join(', ')}
                        </Badge>
                      </>
                    ) : null}
                  </th>
                  <td className={styles.nowrap}>{formatDuration(row.durationMinutes)}</td>
                  <td>{row.item.owner ?? '—'}</td>
                  <td>{row.item.notes ?? ''}</td>
                  <td>
                    <span className={styles.buttons}>
                      <Button
                        id={`edit-run-${row.item.id}`}
                        variant="ghost"
                        icon={<Pencil aria-hidden size={14} />}
                        aria-label={`Edit ${row.item.title}`}
                        onClick={() => {
                          setMode({ kind: 'edit', id: row.item.id });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        icon={<Trash2 aria-hidden size={14} />}
                        aria-label={`Remove ${row.item.title}`}
                        onClick={() => {
                          if (
                            commit(
                              [{ op: 'runOrder/remove', itemId: row.item.id }],
                              `Removed ${row.item.title} from the running order.`,
                            )
                          ) {
                            if (mode?.kind === 'edit' && mode.id === row.item.id)
                              setMode(null);
                            document.getElementById('add-run-item')?.focus();
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode ? (
        <RunOrderForm
          key={mode.kind === 'edit' ? mode.id : 'new'}
          item={editing}
          onCancel={() => {
            close(editing ? `edit-run-${editing.id}` : 'add-run-item');
          }}
          onSave={(item) => {
            if (
              commit(
                [{ op: 'runOrder/upsert', item }],
                editing
                  ? `Saved ${item.title} (${item.start}–${item.end}).`
                  : `Added ${item.title} (${item.start}–${item.end}).`,
              )
            ) {
              close(editing ? `edit-run-${item.id}` : 'add-run-item');
            }
          }}
        />
      ) : null}
    </Card>
  );
}

function RunOrderForm({
  item,
  onSave,
  onCancel,
}: {
  item: RunOrderItem | null;
  onSave: (item: RunOrderItem) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<RunOrderFormValues>(() =>
    valuesFromRunOrder(item),
  );
  const [errors, setErrors] = useState<RunOrderErrors>({});
  const order: RunOrderField[] = ['title', 'start', 'end', 'owner', 'notes'];

  useEffect(() => {
    document.getElementById('field-run-title')?.focus();
  }, []);

  const set = (name: RunOrderField, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const result = parseRunOrderForm(values, item?.id ?? createId('run'));
    if (!result.ok) {
      setErrors(result.errors);
      const first = order.find((f) => result.errors[f]);
      if (first) document.getElementById(`field-run-${first}`)?.focus();
      return;
    }
    onSave(result.item);
  };

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      noValidate
      aria-label={item ? `Edit ${item.title}` : 'Add a running-order item'}
    >
      <div className={styles.wide}>
        <TextField
          name="run-title"
          label="Item"
          value={values.title}
          maxLength={100}
          required
          autoComplete="off"
          error={errors.title}
          onChange={(v) => {
            set('title', v);
          }}
        />
      </div>
      <TextField
        name="run-start"
        label="Starts"
        type="time"
        required
        value={values.start}
        hint="Local time, like 18:30"
        error={errors.start}
        onChange={(v) => {
          set('start', v);
        }}
      />
      <TextField
        name="run-end"
        label="Ends"
        type="time"
        required
        value={values.end}
        hint="Must be after the start, on the same day"
        error={errors.end}
        onChange={(v) => {
          set('end', v);
        }}
      />
      <TextField
        name="run-owner"
        label="Who"
        value={values.owner}
        maxLength={60}
        autoComplete="off"
        error={errors.owner}
        onChange={(v) => {
          set('owner', v);
        }}
      />
      <div className={styles.wide}>
        <TextField
          name="run-notes"
          label="Notes"
          value={values.notes}
          multiline
          maxLength={300}
          error={errors.notes}
          onChange={(v) => {
            set('notes', v);
          }}
        />
      </div>
      <div className={`${styles.buttons} ${styles.wide}`}>
        <Button type="submit">{item ? 'Save item' : 'Add to running order'}</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
