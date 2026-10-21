import { UserPlus, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { usePlannerDispatch } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { FactList } from '@/components/FactList.tsx';
import type { Option } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import { TextField } from '@/components/TextField.tsx';
import { applyOperations } from '@/domain/editEvent.ts';
import { createId } from '@/domain/ids.ts';
import { LIMITS, RSVP_STATUSES } from '@/domain/primitives.ts';
import { guestRecordSchema } from '@/domain/schemas.ts';
import { selectGuestSummary } from '@/domain/selectors.ts';
import type { EventRecord, GuestRecord } from '@/domain/types.ts';
import styles from './GuestsCard.module.css';

type Rsvp = GuestRecord['rsvp'];

const RSVP_OPTIONS: Option<Rsvp>[] = RSVP_STATUSES.map((value) => ({
  value,
  label: { invited: 'Invited, no reply', accepted: 'Accepted', declined: 'Declined' }[
    value
  ],
}));

interface FormErrors {
  name?: string;
  partySize?: string;
}

/**
 * Guest planning lives with the event's details: who is invited, how many
 * people they bring, and what they have replied. Everything shown is counted
 * from the guests actually entered.
 */
export function GuestsCard({ event }: { event: EventRecord }) {
  const dispatch = usePlannerDispatch();
  const summary = selectGuestSummary(event);
  const { guests } = event;

  const [name, setName] = useState('');
  const [partySize, setPartySize] = useState('1');
  const [rsvp, setRsvp] = useState<Rsvp>('invited');
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<{ text: string; tone: StatusTone } | null>(null);

  const edit = (operations: Parameters<typeof applyOperations>[1]) => {
    if (!applyOperations(event, operations)) return false;
    dispatch({
      type: 'event/edit',
      eventId: event.profile.id,
      operations,
      expectedRevision: event.profile.revision,
    });
    return true;
  };

  const addGuest = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const nextErrors: FormErrors = {};
    const sizeText = partySize.trim();
    const size = /^\d+$/.test(sizeText) ? Number(sizeText) : Number.NaN;
    if (sizeText === '') nextErrors.partySize = 'Enter how many people';
    else if (Number.isNaN(size)) nextErrors.partySize = 'Enter a whole number, like 2';

    const guest = {
      id: createId('guest'),
      name,
      partySize: size,
      rsvp,
      dietaryNeeds: [],
      accessibilityNeeds: [],
    };
    const parsed = guestRecordSchema.safeParse(guest);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'name') nextErrors.name ??= issue.message;
        if (issue.path[0] === 'partySize') nextErrors.partySize ??= issue.message;
      }
    }
    if (!parsed.success || Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const first = nextErrors.name ? 'guest-name' : 'guest-party';
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    if (!edit([{ op: 'guests/upsert', item: parsed.data }])) {
      setMessage({
        text: `Could not add this guest. An event can hold up to ${LIMITS.guests} guest entries.`,
        tone: 'error',
      });
      return;
    }
    setErrors({});
    setName('');
    setPartySize('1');
    setRsvp('invited');
    setMessage({ text: `Added ${parsed.data.name}.`, tone: 'success' });
    document.getElementById('field-guest-name')?.focus();
  };

  const atLimit = guests.length >= LIMITS.guests;
  const over = summary.recordedPeople > summary.expectedGuests;

  return (
    <Card
      title="Guests"
      description="Who is invited and what they have replied. Counts come from the guests you enter below."
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
      {over ? (
        <p className={styles.note}>
          You have listed more people than the expected {summary.expectedGuests}. If the
          guest count has changed, update it with “Edit event”.
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
          label="Guest or family name"
          value={name}
          maxLength={80}
          autoComplete="off"
          error={errors.name}
          onChange={(value) => {
            setName(value);
            setErrors((current) => ({ ...current, name: undefined }));
          }}
        />
        <TextField
          name="guest-party"
          label="People in this party"
          value={partySize}
          inputMode="numeric"
          hint={`1 to ${LIMITS.partySize}`}
          error={errors.partySize}
          onChange={(value) => {
            setPartySize(value);
            setErrors((current) => ({ ...current, partySize: undefined }));
          }}
        />
        <Select
          name="guest-rsvp"
          label="Reply"
          value={rsvp}
          options={RSVP_OPTIONS}
          onChange={(value) => {
            if (value) setRsvp(value);
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
            <li key={guest.id} className={styles.row}>
              <div className={styles.who}>
                <strong>{guest.name}</strong>
                <span className={styles.party}>
                  {guest.partySize === 1 ? '1 person' : `${guest.partySize} people`}
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
                    text: `Updated the reply from ${guest.name}.`,
                    tone: 'success',
                  });
                }}
              />
              <Button
                variant="secondary"
                size="small"
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
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
