import { CalendarPlus, Download, PartyPopper, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCalendar,
  usePlannerDispatch,
  usePlannerState,
} from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { DEMO_DISCLOSURE, DEMO_PRESETS, buildDemoEvent } from '@/data/presets.ts';
import {
  ACCESSIBILITY_LABELS,
  DIETARY_LABELS,
  EVENT_TYPE_LABELS,
  PRIORITY_LABELS,
  SETTING_LABELS,
  AGE_BAND_LABELS,
} from '@/data/labels.ts';
import { formatDate } from '@/domain/dates.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { createEventRecord } from '@/domain/eventRecord.ts';
import { createId } from '@/domain/ids.ts';
import { formatMoney } from '@/domain/money.ts';
import {
  selectActiveEvent,
  selectCanCreateEvent,
  selectDaysUntil,
} from '@/domain/selectors.ts';
import type { EventRecord } from '@/domain/types.ts';
import { LIMITS } from '@/domain/primitives.ts';
import { buildJsonExport, downloadFile } from '@/services/export.ts';
import { EventForm } from './EventForm.tsx';
import { emptyFormValues, valuesFromRecord, type EditableProfile } from './eventForm.ts';
import type { Preferences } from '@/domain/types.ts';
import styles from './EventsPage.module.css';

type Mode = 'idle' | 'create' | 'edit';

function countdown(days: number): string {
  if (days > 1) return `${days} days to go`;
  if (days === 1) return 'Tomorrow';
  if (days === 0) return 'Today';
  return 'Date has passed';
}

const list = (items: readonly string[]) =>
  items.length > 0 ? items.join(', ') : 'None chosen';

export function EventsPage() {
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const calendar = useCalendar();
  const [mode, setMode] = useState<Mode>('idle');
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  const active = selectActiveEvent(state);
  const canCreate = selectCanCreateEvent(state);

  const announce = (text: string, problem = false) => {
    setMessage({ text, problem });
  };

  const createEvent = (profile: EditableProfile, preferences: Preferences) => {
    if (!canCreate) {
      announce(`You can keep up to ${LIMITS.events} events. Delete one first.`, true);
      return;
    }
    const record = createEventRecord({ id: createId('event'), ...profile }, preferences);
    dispatch({ type: 'event/create', record });
    setMode('idle');
    announce(`Created “${record.profile.title}” and made it the active event.`);
  };

  const createDemo = (presetIndex: number) => {
    const preset = DEMO_PRESETS[presetIndex];
    if (!preset) return;
    if (!canCreate) {
      announce(`You can keep up to ${LIMITS.events} events. Delete one first.`, true);
      return;
    }
    const record = buildDemoEvent(preset, { eventId: createId('event'), calendar });
    dispatch({ type: 'event/create', record });
    announce(`Created “${record.profile.title}” and made it the active event.`);
  };

  const saveEdit = (
    current: EventRecord,
    profile: EditableProfile,
    preferences: Preferences,
  ) => {
    const operations = [
      {
        op: 'profile/patch' as const,
        patch: { ...profile, ageBand: profile.ageBand ?? null },
      },
      { op: 'preferences/set' as const, preferences },
    ];
    if (!applyOperations(current, operations)) {
      announce(
        'Those changes could not be saved. Check the details and try again.',
        true,
      );
      return;
    }
    dispatch({
      type: 'event/edit',
      eventId: current.profile.id,
      operations,
      expectedRevision: current.profile.revision,
    });
    setMode('idle');
    announce('Saved your changes.');
  };

  return (
    <>
      <PageHeader
        title="Events"
        description="Create events, switch between them, and keep each plan's details in one place."
        actions={
          <Button
            icon={<CalendarPlus aria-hidden size={18} />}
            disabled={!canCreate}
            onClick={() => {
              setMessage(null);
              setMode('create');
            }}
          >
            New event
          </Button>
        }
      />

      <p className={styles.privacy}>
        Events are saved only in this browser. This is not an account and the data is not
        encrypted. <Link to="/data">Learn more or manage saved data</Link>.
      </p>

      <div role="status" className={styles.message} data-problem={message?.problem}>
        {message?.text}
      </div>

      {mode === 'create' ? (
        <EventForm
          key="create"
          heading="New event"
          submitLabel="Create event"
          initialValues={emptyFormValues}
          onSubmit={createEvent}
          onCancel={() => {
            setMode('idle');
          }}
        />
      ) : null}

      {mode === 'edit' && active ? (
        <EventForm
          key={`edit-${active.profile.id}-${active.profile.revision}`}
          heading={`Edit “${active.profile.title}”`}
          submitLabel="Save changes"
          initialValues={valuesFromRecord(active)}
          onSubmit={(profile, preferences) => {
            saveEdit(active, profile, preferences);
          }}
          onCancel={() => {
            setMode('idle');
          }}
        />
      ) : null}

      <section className={styles.section} aria-labelledby="your-events">
        <h2 id="your-events">Your events ({state.events.length})</h2>
        {state.events.length === 0 ? (
          <EmptyState title="No events yet">
            Create an event with the form, or start from a fictional demonstration below.
          </EmptyState>
        ) : (
          <ul className={styles.events}>
            {state.events.map((event) => {
              const { profile } = event;
              const isActive = profile.id === state.activeEventId;
              return (
                <li key={profile.id} className={styles.card} data-active={isActive}>
                  <h3 className={styles.cardTitle}>
                    {profile.title}
                    {isActive ? <span className={styles.badge}>Active</span> : null}
                    {profile.demoPresetId ? (
                      <span className={styles.badge}>Demo</span>
                    ) : null}
                  </h3>
                  <p className={styles.meta}>
                    {EVENT_TYPE_LABELS[profile.eventType]} · {formatDate(profile.date)} ·{' '}
                    {profile.guestCount} guests · {formatMoney(profile.budgetPaise)}
                  </p>
                  <div className={styles.cardActions}>
                    {isActive ? null : (
                      <Button
                        variant="secondary"
                        aria-label={`Switch to this event: ${profile.title}`}
                        onClick={() => {
                          dispatch({ type: 'event/switch', eventId: profile.id });
                          announce(`Switched to “${profile.title}”.`);
                        }}
                      >
                        Switch to this event
                      </Button>
                    )}
                    <ConfirmAction
                      label="Delete"
                      accessibleName={`Delete ${profile.title}`}
                      icon={<Trash2 aria-hidden size={18} />}
                      confirmLabel="Yes, delete this event"
                      message={`Delete “${profile.title}” and everything planned for it? This cannot be undone.`}
                      onConfirm={() => {
                        dispatch({ type: 'event/delete', eventId: profile.id });
                        announce(`Deleted “${profile.title}”.`);
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {active ? (
        <section className={styles.section} aria-labelledby="active-event">
          <div className={styles.activeHeader}>
            <h2 id="active-event">Active event: {active.profile.title}</h2>
            <div className={styles.cardActions}>
              <Button
                variant="secondary"
                icon={<Pencil aria-hidden size={18} />}
                onClick={() => {
                  setMessage(null);
                  setMode('edit');
                }}
              >
                Edit event
              </Button>
              <Button
                variant="secondary"
                icon={<Download aria-hidden size={18} />}
                onClick={() => {
                  downloadFile(buildJsonExport(state));
                }}
              >
                Export all events (JSON)
              </Button>
            </div>
          </div>
          <p className={styles.meta}>
            {countdown(selectDaysUntil(active.profile, calendar))}
            {active.profile.demoPresetId ? ` · ${DEMO_DISCLOSURE}` : ''}
          </p>
          <dl className={styles.facts}>
            <Fact label="Date" value={formatDate(active.profile.date)} />
            <Fact label="City" value={active.profile.city} />
            <Fact label="Expected guests" value={String(active.profile.guestCount)} />
            <Fact label="Budget" value={formatMoney(active.profile.budgetPaise)} />
            <Fact label="Setting" value={SETTING_LABELS[active.profile.setting]} />
            {active.profile.ageBand ? (
              <Fact label="Age band" value={AGE_BAND_LABELS[active.profile.ageBand]} />
            ) : null}
            <Fact
              label="Priorities"
              value={list(active.preferences.priorities.map((p) => PRIORITY_LABELS[p]))}
            />
            <Fact
              label="Dietary needs"
              value={list(active.preferences.dietaryNeeds.map((d) => DIETARY_LABELS[d]))}
            />
            <Fact
              label="Accessibility"
              value={list(
                active.preferences.accessibilityNeeds.map((a) => ACCESSIBILITY_LABELS[a]),
              )}
            />
            <Fact
              label="Cultural preferences"
              value={list(active.preferences.culturalPreferences)}
            />
          </dl>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="demos">
        <h2 id="demos">Try a demonstration</h2>
        <p className={styles.meta}>{DEMO_DISCLOSURE} Dates are counted from today.</p>
        <ul className={styles.events}>
          {DEMO_PRESETS.map((preset, index) => (
            <li key={preset.id} className={styles.card}>
              <h3 className={styles.cardTitle}>
                {preset.label} <span className={styles.badge}>Demo</span>
              </h3>
              <p className={styles.meta}>{preset.summary}</p>
              <div className={styles.cardActions}>
                <Button
                  variant="secondary"
                  icon={<PartyPopper aria-hidden size={18} />}
                  disabled={!canCreate}
                  aria-label={`Create demo: ${preset.label}`}
                  onClick={() => {
                    createDemo(index);
                  }}
                >
                  Create demo
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
