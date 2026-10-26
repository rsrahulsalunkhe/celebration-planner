import { Pencil, UserMinus, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCalendar, usePlannerDispatch } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { FactList } from '@/components/FactList.tsx';
import type { Option } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import { TextField } from '@/components/TextField.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { createId } from '@/domain/ids.ts';
import {
  guestCountSuggestions,
  previewGuestCount,
  type GuestCountPreview,
} from '@/domain/planning/guests.ts';
import { LIMITS, RSVP_STATUSES } from '@/domain/primitives.ts';
import { guestRecordSchema } from '@/domain/schemas.ts';
import { selectGuestSummary } from '@/domain/selectors.ts';
import type { ChangeOperation, EventRecord, GuestRecord } from '@/domain/types.ts';
import styles from './GuestsCard.module.css';

type Rsvp = GuestRecord['rsvp'];

const RSVP_OPTIONS: Option<Rsvp>[] = RSVP_STATUSES.map((value) => ({
  value,
  label: { invited: 'Invited, no reply', accepted: 'Accepted', declined: 'Declined' }[
    value
  ],
}));

interface GuestValues {
  name: string;
  partySize: string;
  rsvp: Rsvp;
  notes: string;
}

interface FormErrors {
  name?: string;
  partySize?: string;
  notes?: string;
}

const EMPTY: GuestValues = { name: '', partySize: '1', rsvp: 'invited', notes: '' };

/** Validates guest form text. A blank or non-numeric group size is an error, never 1 or 0. */
function parseGuest(
  values: GuestValues,
  existing: GuestRecord | null,
): { ok: true; guest: GuestRecord } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const sizeText = values.partySize.trim();
  const size = /^\d+$/.test(sizeText) ? Number(sizeText) : Number.NaN;
  if (sizeText === '') errors.partySize = 'Enter how many people';
  else if (Number.isNaN(size)) errors.partySize = 'Enter a whole number, like 2';
  const notes = values.notes.trim();
  const parsed = guestRecordSchema.safeParse({
    id: existing?.id ?? createId('guest'),
    name: values.name,
    partySize: size,
    rsvp: values.rsvp,
    dietaryNeeds: existing?.dietaryNeeds ?? [],
    accessibilityNeeds: existing?.accessibilityNeeds ?? [],
    ...(notes ? { notes } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = issue.path[0];
      if (head === 'name') errors.name ??= issue.message;
      if (head === 'partySize') errors.partySize ??= issue.message;
      if (head === 'notes') errors.notes ??= issue.message;
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, guest: parsed.data };
}

/**
 * Guest planning lives with the event's details: names or aliases, group
 * sizes, replies and optional dietary or access notes. No contact details are
 * asked for and nobody is invited from here.
 *
 * Replies are counted separately. The expected guest count is what every
 * per-guest cost uses, and it only changes when the organizer previews and
 * applies a new count.
 */
export function GuestsCard({ event }: { event: EventRecord }) {
  const dispatch = usePlannerDispatch();
  const summary = selectGuestSummary(event);
  const { guests } = event;

  const [values, setValues] = useState<GuestValues>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: StatusTone } | null>(null);

  const edit = (operations: readonly ChangeOperation[], expectedRevision?: number) => {
    if (!applyOperations(event, operations)) return false;
    dispatch({
      type: 'event/edit',
      eventId: event.profile.id,
      operations,
      expectedRevision: expectedRevision ?? event.profile.revision,
    });
    return true;
  };

  const addGuest = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const result = parseGuest(values, null);
    if (!result.ok) {
      setErrors(result.errors);
      const first = result.errors.name
        ? 'guest-name'
        : result.errors.partySize
          ? 'guest-party'
          : 'guest-notes';
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    if (!edit([{ op: 'guests/upsert', item: result.guest }])) {
      setMessage({
        text: `Could not add this guest. An event can hold up to ${LIMITS.guests} guest entries.`,
        tone: 'error',
      });
      return;
    }
    setErrors({});
    setValues(EMPTY);
    setMessage({ text: `Added ${result.guest.name}.`, tone: 'success' });
    document.getElementById('field-guest-name')?.focus();
  };

  const atLimit = guests.length >= LIMITS.guests;
  const over = summary.recordedPeople > summary.expectedGuests;

  return (
    <Card
      title="Guests"
      description="Names or aliases, group sizes and replies. No contact details are needed, and nobody is invited from here."
    >
      <FactList
        facts={[
          { label: 'Expected guests', value: String(summary.expectedGuests) },
          { label: 'People listed', value: String(summary.recordedPeople) },
          { label: 'Accepted', value: String(summary.accepted) },
          { label: 'Declined', value: String(summary.declined) },
          { label: 'No reply yet', value: String(summary.invited) },
        ]}
      />
      <p className={styles.hint}>
        The budget and plan use the expected guest count ({summary.expectedGuests}).
        Replies are counted separately and never change it on their own.
      </p>
      {over ? (
        <p className={styles.note}>
          You have listed more people than the expected {summary.expectedGuests}. If the
          guest count has changed, preview a new count below.
        </p>
      ) : null}

      <form
        className={styles.form}
        onSubmit={addGuest}
        noValidate
        aria-label="Add a guest"
      >
        <TextField
          name="guest-name"
          required
          label="Name or alias"
          value={values.name}
          maxLength={80}
          autoComplete="off"
          hint="A family name or nickname is enough."
          error={errors.name}
          onChange={(value) => {
            setValues((v) => ({ ...v, name: value }));
            setErrors((current) => ({ ...current, name: undefined }));
          }}
        />
        <TextField
          name="guest-party"
          label="Group size"
          value={values.partySize}
          inputMode="numeric"
          hint={`1 to ${LIMITS.partySize} people`}
          error={errors.partySize}
          onChange={(value) => {
            setValues((v) => ({ ...v, partySize: value }));
            setErrors((current) => ({ ...current, partySize: undefined }));
          }}
        />
        <Select
          name="guest-rsvp"
          label="Reply"
          value={values.rsvp}
          options={RSVP_OPTIONS}
          onChange={(value) => {
            if (value) setValues((v) => ({ ...v, rsvp: value }));
          }}
        />
        <TextField
          name="guest-notes"
          label="Dietary or access notes (optional)"
          value={values.notes}
          maxLength={200}
          autoComplete="off"
          error={errors.notes}
          onChange={(value) => {
            setValues((v) => ({ ...v, notes: value }));
            setErrors((current) => ({ ...current, notes: undefined }));
          }}
        />
        <div className={styles.submit}>
          <Button
            type="submit"
            icon={<UserPlus aria-hidden size={18} />}
            disabled={atLimit}
          >
            Add guest
          </Button>
        </div>
      </form>
      {atLimit ? (
        <p className={styles.note}>
          You have reached the limit of {LIMITS.guests} guest entries for this event.
        </p>
      ) : null}

      <StatusMessage message={message?.text} tone={message?.tone ?? 'info'} />

      {guests.length === 0 ? (
        <p className={styles.empty}>No guests listed yet.</p>
      ) : (
        <ul className={styles.list} aria-label="Guest list">
          {guests.map((guest) => (
            <li key={guest.id} className={styles.item}>
              <div className={styles.row}>
                <div className={styles.who}>
                  <strong>{guest.name}</strong>
                  <span className={styles.party}>
                    {guest.partySize === 1 ? '1 person' : `${guest.partySize} people`}
                    {guest.notes ? ` · ${guest.notes}` : ''}
                  </span>
                </div>
                <Select
                  name={`rsvp-${guest.id}`}
                  label={`Reply from ${guest.name}`}
                  value={guest.rsvp}
                  options={RSVP_OPTIONS}
                  onChange={(value) => {
                    if (!value) return;
                    edit([{ op: 'guests/upsert', item: { ...guest, rsvp: value } }]);
                    setMessage({
                      text: `Updated the reply from ${guest.name}. The expected guest count is unchanged.`,
                      tone: 'success',
                    });
                  }}
                />
                <div className={styles.buttons}>
                  <Button
                    id={`edit-guest-${guest.id}`}
                    variant="secondary"
                    icon={<Pencil aria-hidden size={16} />}
                    aria-label={`Edit ${guest.name}`}
                    aria-expanded={editingId === guest.id}
                    onClick={() => {
                      setEditingId((id) => (id === guest.id ? null : guest.id));
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<UserMinus aria-hidden size={16} />}
                    aria-label={`Remove ${guest.name}`}
                    onClick={() => {
                      edit([{ op: 'guests/remove', itemId: guest.id }]);
                      setMessage({ text: `Removed ${guest.name}.`, tone: 'success' });
                      document.getElementById('field-guest-name')?.focus();
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {editingId === guest.id ? (
                <GuestEditor
                  guest={guest}
                  onCancel={() => {
                    setEditingId(null);
                    document.getElementById(`edit-guest-${guest.id}`)?.focus();
                  }}
                  onSave={(next) => {
                    if (!edit([{ op: 'guests/upsert', item: next }])) return;
                    setEditingId(null);
                    setMessage({ text: `Saved ${next.name}.`, tone: 'success' });
                    setTimeout(() => {
                      document.getElementById(`edit-guest-${guest.id}`)?.focus();
                    }, 0);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ForecastCount event={event} edit={edit} onMessage={setMessage} />
    </Card>
  );
}

function GuestEditor({
  guest,
  onSave,
  onCancel,
}: {
  guest: GuestRecord;
  onSave: (guest: GuestRecord) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<GuestValues>({
    name: guest.name,
    partySize: String(guest.partySize),
    rsvp: guest.rsvp,
    notes: guest.notes ?? '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const id = (field: string) => `guest-${guest.id}-${field}`;

  return (
    <form
      className={styles.form}
      noValidate
      aria-label={`Edit ${guest.name}`}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        const result = parseGuest(values, guest);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        onSave(result.guest);
      }}
    >
      <TextField
        name={id('name')}
        label="Name or alias"
        value={values.name}
        maxLength={80}
        autoComplete="off"
        error={errors.name}
        onChange={(value) => {
          setValues((v) => ({ ...v, name: value }));
        }}
      />
      <TextField
        name={id('party')}
        label="Group size"
        value={values.partySize}
        inputMode="numeric"
        error={errors.partySize}
        onChange={(value) => {
          setValues((v) => ({ ...v, partySize: value }));
        }}
      />
      <TextField
        name={id('notes')}
        label="Dietary or access notes (optional)"
        value={values.notes}
        maxLength={200}
        autoComplete="off"
        error={errors.notes}
        onChange={(value) => {
          setValues((v) => ({ ...v, notes: value }));
        }}
      />
      <div className={styles.submit}>
        <span className={styles.buttons}>
          <Button type="submit">Save guest</Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </span>
      </div>
    </form>
  );
}

/**
 * An explicit way to change the forecasting count from the replies: preview
 * first, then apply. The preview is rejected if anything changed meanwhile.
 */
function ForecastCount({
  event,
  edit,
  onMessage,
}: {
  event: EventRecord;
  edit: (operations: readonly ChangeOperation[], expectedRevision?: number) => boolean;
  onMessage: (message: { text: string; tone: StatusTone }) => void;
}) {
  const today = useCalendar().today();
  const suggestions = guestCountSuggestions(event);
  const [countText, setCountText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [preview, setPreview] = useState<GuestCountPreview | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // A new preview is where the result and the choices are, so focus goes there.
  useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);
  const stale = preview !== null && preview.baseRevision !== event.profile.revision;

  const run = (count: number) => {
    const result = previewGuestCount(event, count, PLANNING_CONFIGURATION, today);
    if (!result.ok) {
      setError(result.reason);
      setPreview(null);
      return;
    }
    setError(undefined);
    setPreview(result.preview);
  };

  return (
    <section className={styles.forecast} aria-labelledby="forecast-count-heading">
      <h3 id="forecast-count-heading">Change the expected guest count</h3>
      <p className={styles.hint}>
        Preview what a new count does to the budget before using it. Nothing changes until
        you apply it.
      </p>
      <div className={styles.buttons}>
        {suggestions
          .filter((s) => s.count > 0)
          .map((s) => (
            <Button
              key={s.key}
              variant="secondary"
              onClick={() => {
                setCountText(String(s.count));
                run(s.count);
              }}
            >
              Preview {s.label.toLowerCase()} ({s.count})
            </Button>
          ))}
      </div>
      <form
        className={styles.inline}
        noValidate
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          const text = countText.trim();
          if (!/^\d+$/.test(text)) {
            setError('Enter a whole number, like 120');
            setPreview(null);
            return;
          }
          run(Number(text));
        }}
      >
        <TextField
          name="forecast-count"
          required
          label="New expected guest count"
          value={countText}
          inputMode="numeric"
          error={error}
          onChange={(value) => {
            setCountText(value);
            setError(undefined);
          }}
        />
        <Button type="submit" variant="secondary">
          Preview
        </Button>
      </form>
      {preview ? (
        <div
          ref={previewRef}
          tabIndex={-1}
          className={styles.preview}
          role="region"
          aria-label="Guest count preview"
        >
          {stale ? (
            <p className={styles.note}>
              This preview is out of date because the event changed. Preview it again.
            </p>
          ) : null}
          <ul>
            {preview.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className={styles.buttons}>
            {!stale ? (
              <Button
                onClick={() => {
                  if (edit(preview.operations, preview.baseRevision)) {
                    onMessage({
                      text: `Expected guests is now ${preview.to}. Per-guest costs follow it.`,
                      tone: 'success',
                    });
                    setPreview(null);
                    setCountText('');
                  }
                }}
              >
                Use {preview.to} expected guests
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setPreview(null);
                onMessage({
                  text: `Kept ${event.profile.guestCount} expected guests. Nothing was changed.`,
                  tone: 'info',
                });
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
