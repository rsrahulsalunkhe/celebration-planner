import { CalendarPlus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { useCalendar, usePlannerDispatch } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { FactList } from '@/components/FactList.tsx';
import { toOptions, type Option } from '@/components/options.ts';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Select } from '@/components/Select.tsx';
import { Stack } from '@/components/Stack.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import {
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
  URGENCY_LABELS,
} from '@/data/labels.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatDate } from '@/domain/dates.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { LIMITS } from '@/domain/primitives.ts';
import {
  NO_FILTERS,
  buildTimeline,
  filterTimeline,
  groupByPhase,
  keepDeadlineOperation,
  ownersOf,
  plannedDeadlineOperation,
  startingTimelineOperations,
  statusOperation,
  type StatusFilter,
  type TimelineFilters,
  type TimelineItem,
  type UrgencyFilter,
} from '@/domain/planning/timeline.ts';
import type {
  ChangeOperation,
  EventRecord,
  PlanningTask,
  TaskCategory,
} from '@/domain/types.ts';
import { RunOrderCard } from './RunOrderCard.tsx';
import { TaskEditor } from './TaskEditor.tsx';
import { TaskItem } from './TaskItem.tsx';
import styles from './Timeline.module.css';

const CONFIG = PLANNING_CONFIGURATION;

const STATUS_FILTERS: Option<StatusFilter>[] = [
  { value: 'all', label: 'Any status' },
  { value: 'open', label: 'Not done' },
  ...toOptions(TASK_STATUS_LABELS),
];
const CATEGORY_FILTERS: Option<'all' | 'none' | TaskCategory>[] = [
  { value: 'all', label: 'Any category' },
  ...toOptions(TASK_CATEGORY_LABELS),
  { value: 'none', label: 'No category' },
];
const URGENCY_FILTERS: Option<UrgencyFilter>[] = [
  { value: 'all', label: 'Any urgency' },
  { value: 'behind', label: 'Past its usual deadline' },
  { value: 'blocked', label: 'Waiting for another task' },
  ...toOptions(URGENCY_LABELS),
];

function countdown(days: number): string {
  if (days > 1) return `${days} days`;
  if (days === 1) return '1 day';
  if (days === 0) return 'Today';
  return `Passed ${-days} ${days === -1 ? 'day' : 'days'} ago`;
}

export function TimelinePage() {
  return (
    <ActiveEventGate title="Timeline">
      {(event) => <TimelineWorkspace key={event.profile.id} event={event} />}
    </ActiveEventGate>
  );
}

function TimelineWorkspace({ event }: { event: EventRecord }) {
  const dispatch = usePlannerDispatch();
  const today = useCalendar().today();
  const [message, setMessage] = useState<{ text: string; tone: StatusTone } | null>(null);
  const [filters, setFilters] = useState<TimelineFilters>(NO_FILTERS);
  const [adding, setAdding] = useState(false);

  const commit = (operations: readonly ChangeOperation[], success: string): boolean => {
    if (operations.length === 0 || !applyOperations(event, operations)) {
      setMessage({
        text: 'That change could not be saved. Check the details and try again.',
        tone: 'error',
      });
      return false;
    }
    dispatch({
      type: 'event/edit',
      eventId: event.profile.id,
      operations,
      expectedRevision: event.profile.revision,
    });
    setMessage({ text: success, tone: 'success' });
    return true;
  };

  // Rebuilt when the event or the day changes, not on every filter keystroke.
  const timeline = useMemo(() => buildTimeline(event, today, CONFIG), [event, today]);
  const { health } = timeline;
  const visible = filterTimeline(timeline.items, filters);
  const groups = groupByPhase(visible);
  const owners = ownersOf(event.tasks);
  const review = timeline.items.filter((i) => i.overrideOutdated);

  const setStatus = (task: PlanningTask, status: PlanningTask['status']) => {
    if (task.status === status) return;
    const item = timeline.items.find((i) => i.task.id === task.id);
    const open = item?.blockers ?? [];
    const note =
      status === 'done' && open.length > 0
        ? ` Its prerequisites (${open.map((b) => b.title).join('; ')}) are still open and were not changed.`
        : '';
    commit(
      [statusOperation(task, status)],
      `“${task.title}” is now ${TASK_STATUS_LABELS[status].toLowerCase()}.${note}`,
    );
  };

  const saveTask = (task: PlanningTask, deadlineChanged: boolean): boolean => {
    const exists = event.tasks.some((t) => t.id === task.id);
    return commit(
      [{ op: 'tasks/upsert', item: task }],
      exists
        ? `Saved “${task.title}”.${deadlineChanged ? ' The new deadline is yours and will be kept when the plan is recalculated.' : ''}`
        : `Added “${task.title}”, due ${formatDate(task.dueDate)}.`,
    );
  };

  const ownerOptions: Option[] = [
    { value: 'all', label: 'Anyone' },
    { value: 'unassigned', label: 'Nobody yet' },
    ...owners.map((o) => ({ value: o, label: o })),
  ];
  const filtered = visible.length !== timeline.items.length;

  return (
    <>
      <PageHeader
        title="Timeline"
        description={`For ${event.profile.title}. Preparation, the day itself and follow-ups, counted from the event date. These are planning notes in this browser; nobody is sent anything.`}
      />
      <Stack>
        <StatusMessage message={message?.text} tone={message?.tone ?? 'info'} />

        {timeline.configurationErrors.length > 0 ||
        timeline.dependencyErrors.length > 0 ? (
          <Card
            title="Configuration errors"
            description="The schedule cannot be trusted until these are fixed."
          >
            <ul className={styles.messages}>
              {[...timeline.configurationErrors, ...timeline.dependencyErrors].map(
                (e) => (
                  <li key={e} data-tone="critical">
                    {e}
                  </li>
                ),
              )}
            </ul>
          </Card>
        ) : null}

        <Card title="Where things stand">
          <FactList
            facts={[
              { label: 'Event date', value: formatDate(event.profile.date) },
              { label: 'Time to go', value: countdown(health.daysUntilEvent) },
              { label: 'Open tasks', value: String(health.open) },
              { label: 'Done', value: String(health.done) },
              { label: 'Past their usual deadline', value: String(health.catchUpCount) },
              { label: 'Overdue', value: String(health.overdueCount) },
            ]}
          />
          {health.messages.length > 0 ? (
            <ul className={styles.messages}>
              {health.messages.map((m) => {
                const tone =
                  health.overloaded && m.includes('feasible')
                    ? 'critical'
                    : health.catchUpCount > 0
                      ? 'warning'
                      : undefined;
                // The word says how serious it is; the colour only repeats it.
                const label =
                  tone === 'critical'
                    ? 'Problem: '
                    : tone === 'warning'
                      ? 'Warning: '
                      : '';
                return (
                  <li key={m} data-tone={tone}>
                    {label ? <strong>{label}</strong> : null}
                    {m}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Card>

        {event.tasks.length === 0 ? (
          <Card
            title="Start a timeline"
            description="Steps for this kind of event, each with a reason, a usual lead time and the steps it depends on."
          >
            <Button
              icon={<CalendarPlus aria-hidden size={18} />}
              onClick={() => {
                const ops = startingTimelineOperations(event, CONFIG, today);
                if (ops.length === 0) {
                  setMessage({
                    text: 'This event has passed, so no plan is generated. You can still add your own tasks below.',
                    tone: 'info',
                  });
                  return;
                }
                commit(
                  ops,
                  `Created ${ops.length} planned steps from the event details.`,
                );
              }}
            >
              Create timeline from the plan
            </Button>
          </Card>
        ) : null}

        {review.length > 0 ? (
          <Card
            title="Deadlines to review"
            description="You set these by hand. They were not moved, so check they still make sense."
          >
            <ul className={styles.review}>
              {review.map((item) => (
                <ReviewRow
                  key={item.task.id}
                  item={item}
                  onKeep={() =>
                    commit(
                      [keepDeadlineOperation(item.task, event.profile.date)],
                      `Kept ${formatDate(item.task.dueDate)} for “${item.task.title}”.`,
                    )
                  }
                  plannedOp={plannedDeadlineOperation(event, item.task, CONFIG, today)}
                  onPlanned={(op) =>
                    commit(
                      [op],
                      `“${item.task.title}” follows the planned deadline again.`,
                    )
                  }
                />
              ))}
            </ul>
          </Card>
        ) : null}

        {event.tasks.length > 0 ? (
          <Card title="Filter tasks">
            <div className={styles.filters}>
              <Select
                name="filter-status"
                label="Status"
                value={filters.status}
                options={STATUS_FILTERS}
                onChange={(v) => {
                  if (v) setFilters((f) => ({ ...f, status: v }));
                }}
              />
              <Select
                name="filter-category"
                label="Category"
                value={filters.category}
                options={CATEGORY_FILTERS}
                onChange={(v) => {
                  if (v) setFilters((f) => ({ ...f, category: v }));
                }}
              />
              <Select
                name="filter-urgency"
                label="Urgency"
                value={filters.urgency}
                options={URGENCY_FILTERS}
                onChange={(v) => {
                  if (v) setFilters((f) => ({ ...f, urgency: v }));
                }}
              />
              <Select
                name="filter-owner"
                label="Owner"
                value={filters.owner}
                options={ownerOptions}
                onChange={(v) => {
                  if (v) setFilters((f) => ({ ...f, owner: v }));
                }}
              />
            </div>
            <p className={styles.count} role="status" aria-live="polite">
              Showing {visible.length} of {timeline.items.length} tasks.
            </p>
            {filtered ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters(NO_FILTERS);
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </Card>
        ) : null}

        {groups.map((group) => (
          <Card
            key={group.phase}
            title={group.label}
            description={`${group.items.length} ${group.items.length === 1 ? 'task' : 'tasks'}`}
          >
            <ul className={styles.tasks}>
              {group.items.map((item) => (
                <TaskItem
                  key={item.task.id}
                  item={item}
                  event={event}
                  onStatus={setStatus}
                  onSave={saveTask}
                />
              ))}
            </ul>
          </Card>
        ))}
        {event.tasks.length > 0 && groups.length === 0 ? (
          <p className={styles.muted}>No tasks match these filters.</p>
        ) : null}

        <Card
          title="Add your own task"
          description="Custom tasks are kept exactly as you write them when the plan is recalculated."
          actions={
            adding ? null : (
              <Button
                id="add-task"
                icon={<Plus aria-hidden size={18} />}
                disabled={event.tasks.length >= LIMITS.tasks}
                onClick={() => {
                  setAdding(true);
                }}
              >
                Add task
              </Button>
            )
          }
        >
          {adding ? (
            <TaskEditor
              event={event}
              task={null}
              onCancel={() => {
                setAdding(false);
                setTimeout(() => document.getElementById('add-task')?.focus(), 0);
              }}
              onSave={(task, changed) => {
                const saved = saveTask(task, changed);
                if (saved) {
                  setAdding(false);
                  setTimeout(() => document.getElementById('add-task')?.focus(), 0);
                }
                return saved;
              }}
            />
          ) : null}
        </Card>

        <RunOrderCard event={event} commit={commit} />
      </Stack>
    </>
  );
}

function ReviewRow({
  item,
  onKeep,
  plannedOp,
  onPlanned,
}: {
  item: TimelineItem;
  onKeep: () => void;
  plannedOp: ChangeOperation | null;
  onPlanned: (op: ChangeOperation) => void;
}) {
  return (
    <li>
      <p>
        <strong>{item.task.title}</strong>: due {formatDate(item.task.dueDate)}.{' '}
        {item.overrideProblem}
      </p>
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          aria-label={`Keep this date (${formatDate(item.task.dueDate)}) for “${item.task.title}”`}
          onClick={onKeep}
        >
          Keep this date
        </Button>
        {plannedOp ? (
          <Button
            variant="secondary"
            aria-label={`Use the planned deadline for “${item.task.title}”`}
            onClick={() => {
              onPlanned(plannedOp);
            }}
          >
            Use the planned deadline
          </Button>
        ) : null}
      </div>
    </li>
  );
}
