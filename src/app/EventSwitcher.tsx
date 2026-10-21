import { CalendarPlus } from 'lucide-react';
import { ButtonLink } from '@/components/ButtonLink.tsx';
import type { Option } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import { LIMITS } from '@/domain/primitives.ts';
import { selectCanCreateEvent } from '@/domain/selectors.ts';
import { usePlannerDispatch, usePlannerState } from './state/plannerContext.ts';
import styles from './EventSwitcher.module.css';

interface EventSwitcherProps {
  /** Called after the user follows the New event link. */
  onNavigate?: () => void;
  /** Called after the user chooses a different event. */
  onSwitch?: () => void;
}

/** Choose which saved event the workspace shows, or start a new one. */
export function EventSwitcher({ onNavigate, onSwitch }: EventSwitcherProps) {
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const canCreate = selectCanCreateEvent(state);

  const options: Option[] = state.events.map((e) => ({
    value: e.profile.id,
    label: e.profile.title,
  }));

  return (
    <section className={styles.switcher} aria-label="Event">
      {state.events.length > 0 ? (
        <Select
          name="active-event"
          label="Active event"
          value={state.activeEventId ?? ''}
          options={options}
          onChange={(eventId) => {
            if (!eventId) return;
            dispatch({ type: 'event/switch', eventId });
            onSwitch?.();
          }}
        />
      ) : (
        <p className={styles.empty}>No events yet.</p>
      )}
      {canCreate ? (
        <ButtonLink
          to="/new"
          variant="accent"
          icon={<CalendarPlus aria-hidden size={18} />}
          onClick={onNavigate}
        >
          New event
        </ButtonLink>
      ) : (
        <p className={styles.empty}>
          You have reached the limit of {LIMITS.events} events. Delete one to add another.
        </p>
      )}
    </section>
  );
}
