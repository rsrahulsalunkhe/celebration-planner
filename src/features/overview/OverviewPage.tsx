import {
  CalendarPlus,
  Download,
  FileUp,
  PartyPopper,
  Pencil,
  Printer,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import {
  useCalendar,
  usePlannerDispatch,
  usePlannerState,
} from '@/app/state/plannerContext.ts';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { ButtonLink } from '@/components/ButtonLink.tsx';
import { Card } from '@/components/Card.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { FactList } from '@/components/FactList.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import {
  ACCESSIBILITY_LABELS,
  AGE_BAND_LABELS,
  DIETARY_LABELS,
  EVENT_TYPE_LABELS,
  PRIORITY_LABELS,
  SETTING_LABELS,
} from '@/data/labels.ts';
import { formatDate } from '@/domain/dates.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { formatMoney } from '@/domain/money.ts';
import { withTimelineRegeneration } from '@/domain/planning/timeline.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { selectDaysUntil } from '@/domain/selectors.ts';
import type { EventRecord, Preferences } from '@/domain/types.ts';
import { buildJsonExport, downloadFile } from '@/services/export.ts';
import { EventForm } from '../events/EventForm.tsx';
import { valuesFromRecord, type EditableProfile } from '../events/eventForm.ts';
import { GuestsCard } from '../events/GuestsCard.tsx';
import styles from './OverviewPage.module.css';

function countdown(days: number): string {
  if (days > 1) return `${days} days to go`;
  if (days === 1) return 'Tomorrow';
  if (days === 0) return 'Today';
  return 'This date has passed';
}

const list = (items: readonly string[]) =>
  items.length > 0 ? items.join(', ') : 'None chosen';

export function OverviewPage() {
  const state = usePlannerState();
  if (state.events.length === 0) {
    return (
      <>
        <PageHeader title="Welcome" />
        <EmptyState
          title="Plan your first celebration"
          icon={<PartyPopper aria-hidden size={28} />}
          actions={
            <>
              <ButtonLink
                to="/new"
                variant="accent"
                icon={<CalendarPlus aria-hidden size={18} />}
              >
                Create an event
              </ButtonLink>
              <ButtonLink
                to="/data"
                variant="secondary"
                icon={<FileUp aria-hidden size={18} />}
              >
                Import a plan file
              </ButtonLink>
            </>
          }
        >
          Weddings, birthdays and community events each get their own plan. Everything you
          enter stays in this browser. You can also try a fictional demonstration first,
          or import a plan file you exported earlier.
        </EmptyState>
      </>
    );
  }
  return (
    <ActiveEventGate title="Overview">
      {(event) => <EventOverview key={event.profile.id} event={event} />}
    </ActiveEventGate>
  );
}

function EventOverview({ event }: { event: EventRecord }) {
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const calendar = useCalendar();
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, preferences } = event;

  // A notice from creating an event belongs to that event only, and is shown once.
  const arrival = location.state as { notice?: string; eventId?: string } | null;
  const arrivedWith = arrival?.eventId === profile.id ? arrival.notice : undefined;
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: StatusTone } | null>(
    arrivedWith ? { text: arrivedWith, tone: 'success' } : null,
  );

  useEffect(() => {
    if (arrivedWith) void navigate(location.pathname, { replace: true, state: null });
  }, [arrivedWith, location.pathname, navigate]);

  const days = selectDaysUntil(profile, calendar);

  const saveEdit = (next: EditableProfile, nextPreferences: Preferences) => {
    // Generated deadlines follow the new details; completed, custom and manual ones are kept.
    const { operations, moved, flagged } = withTimelineRegeneration(
      event,
      [
        {
          op: 'profile/patch' as const,
          patch: { ...next, ageBand: next.ageBand ?? null },
        },
        { op: 'preferences/set' as const, preferences: nextPreferences },
      ],
      PLANNING_CONFIGURATION,
      calendar.today(),
    );
    if (!applyOperations(event, operations)) {
      setMessage({
        text: 'Those changes could not be saved. Check the details and try again.',
        tone: 'error',
      });
      return;
    }
    dispatch({
      type: 'event/edit',
      eventId: profile.id,
      operations,
      expectedRevision: profile.revision,
    });
    setEditing(false);
    const timelineNote = [
      moved > 0
        ? `${moved} planned ${moved === 1 ? 'deadline was' : 'deadlines were'} recalculated.`
        : '',
      flagged > 0
        ? `${flagged} ${flagged === 1 ? 'deadline you set needs' : 'deadlines you set need'} review on the Timeline.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    setMessage({
      text: timelineNote ? `Saved your changes. ${timelineNote}` : 'Saved your changes.',
      tone: 'success',
    });
  };

  return (
    <>
      <PageHeader
        title={profile.title}
        badges={
          <>
            {profile.demoPresetId ? <Badge tone="coral">Demo</Badge> : null}
            {days < 0 ? <Badge>Past event</Badge> : null}
          </>
        }
        description={`${EVENT_TYPE_LABELS[profile.eventType]} · ${formatDate(profile.date)} · ${countdown(days)}`}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Pencil aria-hidden size={18} />}
              onClick={() => {
                setMessage(null);
                setEditing(true);
              }}
            >
              Edit event
            </Button>
            <Button
              variant="secondary"
              icon={<Download aria-hidden size={18} />}
              onClick={() => {
                if (!downloadFile(buildJsonExport(state))) {
                  setMessage({
                    text: 'The browser did not start the download. Try again, or use Your data to export.',
                    tone: 'error',
                  });
                }
              }}
            >
              Export JSON
            </Button>
            <ButtonLink
              to="/print"
              variant="secondary"
              icon={<Printer aria-hidden size={18} />}
            >
              Print plan
            </ButtonLink>
            <ConfirmAction
              label="Delete"
              accessibleName={`Delete ${profile.title}`}
              title="Delete this event?"
              icon={<Trash2 aria-hidden size={18} />}
              confirmLabel="Yes, delete this event"
              message={`“${profile.title}” and everything planned for it will be removed from this browser. This cannot be undone. Export first if you may need it.`}
              onConfirm={() => {
                dispatch({ type: 'event/delete', eventId: profile.id });
                // The page for this event is replaced, so put the reader at the new heading.
                setTimeout(() => {
                  document.querySelector<HTMLElement>('main h1')?.focus();
                }, 0);
              }}
            />
          </>
        }
      />

      <Stack>
        <StatusMessage message={message?.text} tone={message?.tone ?? 'info'} />

        {editing ? (
          <EventForm
            key={`edit-${profile.revision}`}
            heading="Edit event details"
            submitLabel="Save changes"
            initialValues={valuesFromRecord(event)}
            onSubmit={saveEdit}
            onCancel={() => {
              setEditing(false);
            }}
          />
        ) : (
          <div className={styles.grid}>
            <Card title="Event details">
              <FactList
                facts={[
                  { label: 'Date', value: formatDate(profile.date) },
                  { label: 'City', value: profile.city },
                  { label: 'Setting', value: SETTING_LABELS[profile.setting] },
                  { label: 'Budget', value: formatMoney(profile.budgetPaise) },
                  { label: 'Expected guests', value: String(profile.guestCount) },
                  ...(profile.ageBand
                    ? [{ label: 'Age band', value: AGE_BAND_LABELS[profile.ageBand] }]
                    : []),
                ]}
              />
            </Card>
            <Card title="Preferences">
              <FactList
                facts={[
                  {
                    label: 'Priorities',
                    value: list(preferences.priorities.map((p) => PRIORITY_LABELS[p])),
                  },
                  {
                    label: 'Dietary needs',
                    value: list(preferences.dietaryNeeds.map((d) => DIETARY_LABELS[d])),
                  },
                  {
                    label: 'Accessibility',
                    value: list(
                      preferences.accessibilityNeeds.map((a) => ACCESSIBILITY_LABELS[a]),
                    ),
                  },
                  {
                    label: 'Cultural preferences',
                    value: list(preferences.culturalPreferences),
                  },
                ]}
              />
            </Card>
          </div>
        )}

        <GuestsCard event={event} />
      </Stack>
    </>
  );
}
