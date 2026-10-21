import { Download, PartyPopper, Trash2 } from 'lucide-react';
import { usePlannerDispatch, usePlannerState } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { sampleWedding } from '@/data/fixtures.ts';
import { daysBetween, formatDate, todayIso } from '@/domain/dates.ts';
import { formatMoney } from '@/domain/money.ts';
import { buildJsonExport, downloadFile } from '@/services/export.ts';
import styles from './EventsPage.module.css';

const TYPE_LABELS = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  community: 'Community event',
} as const;

function countdown(days: number): string {
  if (days > 1) return `${days} days to go`;
  if (days === 1) return 'Tomorrow';
  if (days === 0) return 'Today';
  return 'Already happened';
}

export function EventsPage() {
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const { event } = state;

  if (!event) {
    return (
      <>
        <PageHeader
          title="Event"
          description="Describe the celebration once; the plan, budget and timeline build from it."
        />
        <EmptyState
          title="No event yet"
          actions={
            <Button
              icon={<PartyPopper aria-hidden size={18} />}
              onClick={() => {
                dispatch({ type: 'event/set', event: sampleWedding });
              }}
            >
              Load sample wedding
            </Button>
          }
        >
          The event form arrives in the next stage. For now you can load a fictional
          sample to explore the app. Everything stays in this browser.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={event.name}
        description={`${TYPE_LABELS[event.type]} · ${countdown(daysBetween(todayIso(), event.date))}`}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Download aria-hidden size={18} />}
              onClick={() => {
                downloadFile(buildJsonExport(state));
              }}
            >
              Export JSON
            </Button>
            <Button
              variant="secondary"
              icon={<Trash2 aria-hidden size={18} />}
              onClick={() => {
                dispatch({ type: 'event/clear' });
              }}
            >
              Clear event
            </Button>
          </>
        }
      />
      <dl className={styles.facts}>
        <div>
          <dt>Date</dt>
          <dd>{formatDate(event.date)}</dd>
        </div>
        <div>
          <dt>Guests</dt>
          <dd>{event.guestCount}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{formatMoney(event.budget, event.currency)}</dd>
        </div>
        {event.city ? (
          <div>
            <dt>City</dt>
            <dd>{event.city}</dd>
          </div>
        ) : null}
      </dl>
      {event.notes ? <p className={styles.notes}>{event.notes}</p> : null}
    </>
  );
}
