import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button.tsx';
import { CheckboxGroup } from '@/components/CheckboxGroup.tsx';
import { toOptions } from '@/components/options.ts';
import { SelectField } from '@/components/SelectField.tsx';
import { TextField } from '@/components/TextField.tsx';
import {
  ACCESSIBILITY_LABELS,
  AGE_BAND_LABELS,
  DIETARY_LABELS,
  EVENT_TYPE_LABELS,
  PRIORITY_LABELS,
  SETTING_LABELS,
} from '@/data/labels.ts';
import { LIMITS } from '@/domain/primitives.ts';
import styles from './EventForm.module.css';
import {
  FIELD_ORDER,
  FORM_HINTS,
  validateEventForm,
  type EditableProfile,
  type EventFormValues,
  type FieldName,
  type FormErrors,
} from './eventForm.ts';
import type { IsoDate, Preferences } from '@/domain/types.ts';

const EVENT_TYPE_OPTIONS = toOptions(EVENT_TYPE_LABELS);
const SETTING_OPTIONS = toOptions(SETTING_LABELS);
const AGE_BAND_OPTIONS = toOptions(AGE_BAND_LABELS);
const PRIORITY_OPTIONS = toOptions(PRIORITY_LABELS);
const DIETARY_OPTIONS = toOptions(DIETARY_LABELS);
const ACCESSIBILITY_OPTIONS = toOptions(ACCESSIBILITY_LABELS);

const FIELD_LABELS: Record<FieldName, string> = {
  title: 'Title',
  eventType: 'Event type',
  date: 'Date',
  city: 'City',
  guestCount: 'Expected guests',
  budget: 'Budget',
  setting: 'Setting',
  ageBand: 'Age band',
  priorities: 'Priorities',
  dietaryNeeds: 'Dietary needs',
  dietaryNotes: 'Dietary notes',
  accessibilityNeeds: 'Accessibility requirements',
  accessibilityNotes: 'Accessibility notes',
  culturalPreferences: 'Cultural preferences',
};

interface EventFormProps {
  heading: string;
  /** Set for a new event: the date may not be before this day. */
  newEventToday?: IsoDate;
  submitLabel: string;
  initialValues: EventFormValues;
  onSubmit: (profile: EditableProfile, preferences: Preferences) => void;
  onCancel: () => void;
}

export function EventForm({
  heading,
  newEventToday,
  submitLabel,
  initialValues,
  onSubmit,
  onCancel,
}: EventFormProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const headingId = useId();

  const set = <K extends FieldName>(name: K, value: EventFormValues[K]) => {
    setValues((current) => ({ ...current, [name]: value }));
    // Clear a field's message as soon as the user edits it.
    setErrors((current) => {
      if (!current[name]) return current;
      const { [name]: _removed, ...rest } = current;
      return rest;
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateEventForm(values, newEventToday ? { newEventToday } : {});
    if (result.ok) {
      setErrors({});
      onSubmit(result.profile, result.preferences);
      return;
    }
    setErrors(result.errors);
    const first = FIELD_ORDER.find((name) => result.errors[name]);
    if (first) document.getElementById(`field-${first}`)?.focus();
  };

  const errorNames = FIELD_ORDER.filter((name) => errors[name]);

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className={styles.heading}>
        {heading}
      </h2>

      {errorNames.length > 0 ? (
        <div role="alert" className={styles.summary}>
          <p>
            Please fix {errorNames.length}{' '}
            {errorNames.length === 1 ? 'problem' : 'problems'}:
          </p>
          <ul>
            {errorNames.map((name) => (
              <li key={name}>
                <a
                  href={`#field-${name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(`field-${name}`)?.focus();
                  }}
                >
                  {FIELD_LABELS[name]}
                </a>
                : {errors[name]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.grid}>
        <TextField
          name="title"
          label="Title"
          required
          maxLength={100}
          value={values.title}
          onChange={(v) => {
            set('title', v);
          }}
          error={errors.title}
        />
        <SelectField
          name="eventType"
          label="Event type"
          required
          placeholder="Choose…"
          options={EVENT_TYPE_OPTIONS}
          value={values.eventType}
          onChange={(v) => {
            set('eventType', v);
          }}
          error={errors.eventType}
        />
        <TextField
          name="date"
          label="Date"
          type="date"
          required
          value={values.date}
          onChange={(v) => {
            set('date', v);
          }}
          error={errors.date}
        />
        <TextField
          name="city"
          label="City"
          required
          maxLength={80}
          value={values.city}
          onChange={(v) => {
            set('city', v);
          }}
          error={errors.city}
        />
        <TextField
          name="guestCount"
          label="Expected guests"
          required
          inputMode="numeric"
          hint={FORM_HINTS.guestCount}
          value={values.guestCount}
          onChange={(v) => {
            set('guestCount', v);
          }}
          error={errors.guestCount}
        />
        <TextField
          name="budget"
          label="Budget (₹)"
          required
          inputMode="decimal"
          hint={FORM_HINTS.budget}
          value={values.budget}
          onChange={(v) => {
            set('budget', v);
          }}
          error={errors.budget}
        />
        <SelectField
          name="setting"
          label="Setting"
          required
          placeholder="Choose…"
          options={SETTING_OPTIONS}
          value={values.setting}
          onChange={(v) => {
            set('setting', v);
          }}
          error={errors.setting}
        />
        {values.eventType === 'birthday' ? (
          <SelectField
            name="ageBand"
            label="Age band"
            hint="Optional. We never ask for an exact birth date."
            placeholder="Prefer not to say"
            options={AGE_BAND_OPTIONS}
            value={values.ageBand}
            onChange={(v) => {
              set('ageBand', v);
            }}
            error={errors.ageBand}
          />
        ) : null}
      </div>

      <CheckboxGroup
        name="priorities"
        legend="Priorities"
        hint={`Optional. Choose up to ${LIMITS.priorities}.`}
        options={PRIORITY_OPTIONS}
        selected={values.priorities}
        onChange={(v) => {
          set('priorities', v);
        }}
        error={errors.priorities}
      />
      <CheckboxGroup
        name="dietaryNeeds"
        legend="Dietary needs"
        hint="Optional."
        options={DIETARY_OPTIONS}
        selected={values.dietaryNeeds}
        onChange={(v) => {
          set('dietaryNeeds', v);
        }}
        error={errors.dietaryNeeds}
      />
      <TextField
        name="dietaryNotes"
        label="Dietary notes"
        multiline
        maxLength={300}
        value={values.dietaryNotes}
        onChange={(v) => {
          set('dietaryNotes', v);
        }}
        error={errors.dietaryNotes}
      />
      <CheckboxGroup
        name="accessibilityNeeds"
        legend="Accessibility requirements"
        hint="Optional."
        options={ACCESSIBILITY_OPTIONS}
        selected={values.accessibilityNeeds}
        onChange={(v) => {
          set('accessibilityNeeds', v);
        }}
        error={errors.accessibilityNeeds}
      />
      <TextField
        name="accessibilityNotes"
        label="Accessibility notes"
        multiline
        maxLength={300}
        value={values.accessibilityNotes}
        onChange={(v) => {
          set('accessibilityNotes', v);
        }}
        error={errors.accessibilityNotes}
      />
      <TextField
        name="culturalPreferences"
        label="Cultural preferences"
        hint={FORM_HINTS.culturalPreferences}
        value={values.culturalPreferences}
        onChange={(v) => {
          set('culturalPreferences', v);
        }}
        error={errors.culturalPreferences}
      />

      <div className={styles.actions}>
        <Button type="submit">{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
