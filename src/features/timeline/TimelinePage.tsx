import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { useCalendar } from '@/app/state/plannerContext.ts';
import { Card } from '@/components/Card.tsx';
import { ComingSoon } from '@/components/ComingSoon.tsx';
import { FactList } from '@/components/FactList.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import { formatDate } from '@/domain/dates.ts';
import { selectDaysUntil } from '@/domain/selectors.ts';

function countdown(days: number): string {
  if (days > 1) return `${days} days`;
  if (days === 1) return '1 day';
  if (days === 0) return 'Today';
  return 'This date has passed';
}

export function TimelinePage() {
  const calendar = useCalendar();
  return (
    <ActiveEventGate title="Timeline">
      {(event) => (
        <>
          <PageHeader
            title="Timeline"
            description={`For ${event.profile.title}. Tasks ordered by deadline, counted back from the event date.`}
          />
          <Stack>
            <Card title="Key dates">
              <FactList
                facts={[
                  { label: 'Event date', value: formatDate(event.profile.date) },
                  {
                    label: 'Time to go',
                    value: countdown(selectDaysUntil(event.profile, calendar)),
                  },
                  { label: 'Tasks listed', value: String(event.tasks.length) },
                ]}
              />
            </Card>
            <ComingSoon title="Task list and deadlines">
              <p>
                Dated tasks with dependencies, ideal deadlines and catch-up scheduling are
                written and tested, but this screen does not show or manage them yet.
              </p>
            </ComingSoon>
          </Stack>
        </>
      )}
    </ActiveEventGate>
  );
}
