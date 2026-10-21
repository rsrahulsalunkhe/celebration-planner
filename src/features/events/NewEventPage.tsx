import { PartyPopper } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useCalendar,
  usePlannerDispatch,
  usePlannerState,
} from '@/app/state/plannerContext.ts';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { ButtonLink } from '@/components/ButtonLink.tsx';
import { Card } from '@/components/Card.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import {
  DEMO_DISCLOSURE,
  DEMO_PRESETS,
  buildDemoEvent,
  type DemoPreset,
} from '@/data/presets.ts';
import { createEventRecord } from '@/domain/eventRecord.ts';
import { createId } from '@/domain/ids.ts';
import { LIMITS } from '@/domain/primitives.ts';
import { selectCanCreateEvent } from '@/domain/selectors.ts';
import type { EventRecord, Preferences } from '@/domain/types.ts';
import { EventForm } from './EventForm.tsx';
import { emptyFormValues, type EditableProfile } from './eventForm.ts';
import styles from './NewEventPage.module.css';

export function NewEventPage() {
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const calendar = useCalendar();
  const navigate = useNavigate();

  if (!selectCanCreateEvent(state)) {
    return (
      <>
        <PageHeader title="New event" />
        <ErrorState
          tone="warning"
          title="You have reached the event limit"
          actions={<ButtonLink to="/">Back to Overview</ButtonLink>}
        >
          This browser keeps up to {LIMITS.events} events. Delete one from its Overview
          page to add another.
        </ErrorState>
      </>
    );
  }

  const finish = (created: EventRecord) => {
    void navigate('/', {
      state: {
        notice: `Created “${created.profile.title}” and made it the active event.`,
        eventId: created.profile.id,
      },
    });
  };

  const createFromForm = (profile: EditableProfile, preferences: Preferences) => {
    const record = createEventRecord({ id: createId('event'), ...profile }, preferences);
    dispatch({ type: 'event/create', record });
    finish(record);
  };

  const createDemo = (preset: DemoPreset) => {
    const record = buildDemoEvent(preset, { eventId: createId('event'), calendar });
    dispatch({ type: 'event/create', record });
    finish(record);
  };

  return (
    <>
      <PageHeader
        title="New event"
        description="Describe the celebration once. You can change any detail later."
      />
      <Stack>
        <Card
          title="Start from a demonstration"
          description={`${DEMO_DISCLOSURE} Dates are counted from today.`}
        >
          <ul className={styles.demos}>
            {DEMO_PRESETS.map((preset) => (
              <li key={preset.id} className={styles.demo}>
                <h3 className={styles.demoTitle}>
                  {preset.label} <Badge tone="coral">Demo</Badge>
                </h3>
                <p className={styles.demoSummary}>{preset.summary}</p>
                <Button
                  variant="secondary"
                  icon={<PartyPopper aria-hidden size={18} />}
                  aria-label={`Create demo: ${preset.label}`}
                  onClick={() => {
                    createDemo(preset);
                  }}
                >
                  Create demo
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <EventForm
          heading="Or enter your own event"
          newEventToday={calendar.today()}
          submitLabel="Create event"
          initialValues={emptyFormValues}
          onSubmit={createFromForm}
          onCancel={() => {
            void navigate('/');
          }}
        />
      </Stack>
    </>
  );
}
