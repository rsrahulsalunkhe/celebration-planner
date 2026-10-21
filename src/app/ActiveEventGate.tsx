import { CalendarPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ButtonLink.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { selectActiveEvent } from '@/domain/selectors.ts';
import type { EventRecord } from '@/domain/types.ts';
import { usePlannerState } from './state/plannerContext.ts';

interface ActiveEventGateProps {
  /** The page's heading, shown even when there is no event. */
  title: string;
  children: (event: EventRecord) => ReactNode;
}

/**
 * Every section works on the active event. Without one it says so and points
 * to creating an event, instead of showing empty or invented numbers.
 */
export function ActiveEventGate({ title, children }: ActiveEventGateProps) {
  const event = selectActiveEvent(usePlannerState());
  if (event) return <>{children(event)}</>;
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title="No event selected"
        icon={<CalendarPlus aria-hidden size={28} />}
        actions={<ButtonLink to="/new">Create an event</ButtonLink>}
      >
        This section works on one event at a time. Create or choose an event to begin.
      </EmptyState>
    </>
  );
}
