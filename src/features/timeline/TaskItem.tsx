import { Check, Pencil, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { toOptions } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import {
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
  URGENCY_LABELS,
} from '@/data/labels.ts';
import { formatDate } from '@/domain/dates.ts';
import { KIND_LABELS, type TimelineItem } from '@/domain/planning/timeline.ts';
import type { Urgency } from '@/domain/planning/types.ts';
import type { EventRecord, PlanningTask } from '@/domain/types.ts';
import { TaskEditor } from './TaskEditor.tsx';
import styles from './Timeline.module.css';

const STATUS_OPTIONS = toOptions(TASK_STATUS_LABELS);

const URGENCY_TONES: Record<Urgency, BadgeTone> = {
  done: 'success',
  overdue: 'coral',
  'due-today': 'gold',
  'due-soon': 'gold',
  upcoming: 'neutral',
};

function relative(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

interface TaskItemProps {
  item: TimelineItem;
  event: EventRecord;
  onStatus: (task: PlanningTask, status: PlanningTask['status']) => void;
  onSave: (task: PlanningTask, deadlineChanged: boolean) => boolean;
}

export function TaskItem({ item, event, onStatus, onSave }: TaskItemProps) {
  const [editing, setEditing] = useState(false);
  const { task } = item;
  const done = task.status === 'done';
  const editId = `edit-task-${task.id}`;

  const closeEditor = () => {
    setEditing(false);
    setTimeout(() => {
      document.getElementById(editId)?.focus();
    }, 0);
  };

  return (
    <li className={styles.task} data-done={done}>
      <h3>{task.title}</h3>
      <div className={styles.badges}>
        <Badge tone={URGENCY_TONES[item.urgency]}>{URGENCY_LABELS[item.urgency]}</Badge>
        <Badge>{KIND_LABELS[item.kind]}</Badge>
        {item.origin === 'custom' ? (
          <Badge tone="success">Your task</Badge>
        ) : (
          <Badge>From the plan</Badge>
        )}
        {task.importance === 'critical' ? <Badge tone="navy">Critical</Badge> : null}
        {task.category ? <Badge>{TASK_CATEGORY_LABELS[task.category]}</Badge> : null}
        {task.owner ? <Badge tone="gold">Owner: {task.owner}</Badge> : null}
        {item.blockers.length > 0 && !done ? <Badge tone="coral">Blocked</Badge> : null}
      </div>
      <p className={styles.due}>
        {done ? 'Was due' : 'Due'} {formatDate(task.dueDate)}
        {done ? '' : ` (${relative(item.daysUntilDue)})`}
        {item.manualDeadline ? ' · deadline set by you' : ''}
      </p>

      {item.catchUp ? (
        <div className={styles.catchUp}>
          <p>
            <strong>Usual deadline:</strong> {formatDate(item.catchUp.originalDeadline)}{' '}
            (passed)
          </p>
          <p>
            <strong>{item.catchUp.recommendation}</strong>
          </p>
          <p>{item.catchUp.problem}</p>
        </div>
      ) : null}

      {item.overrideProblem ? (
        <p className={styles.note}>
          <strong>Review this deadline:</strong> {item.overrideProblem}
        </p>
      ) : null}

      {item.blockers.length > 0 && !done ? (
        <p>
          <strong>Waiting for:</strong> {item.blockers.map((b) => b.title).join('; ')}.
        </p>
      ) : null}
      {task.notes ? (
        <p>
          <strong>Notes:</strong> {task.notes}
        </p>
      ) : null}
      {task.rationale ? (
        <details className={styles.why}>
          <summary>Why this step and date</summary>
          <p>{task.rationale}</p>
        </details>
      ) : null}

      <div className={styles.actions}>
        <Select
          name={`status-${task.id}`}
          label={`Status of “${task.title}”`}
          value={task.status}
          options={STATUS_OPTIONS}
          onChange={(v) => {
            if (v) onStatus(task, v);
          }}
        />
        <Button
          variant={done ? 'secondary' : 'primary'}
          icon={
            done ? <RotateCcw aria-hidden size={16} /> : <Check aria-hidden size={16} />
          }
          aria-label={done ? `Reopen: ${task.title}` : `Mark done: ${task.title}`}
          onClick={() => {
            onStatus(task, done ? 'todo' : 'done');
          }}
        >
          {done ? 'Reopen' : 'Mark done'}
        </Button>
        <Button
          id={editId}
          variant="secondary"
          icon={<Pencil aria-hidden size={16} />}
          aria-label={`Edit “${task.title}”`}
          aria-expanded={editing}
          onClick={() => {
            setEditing((open) => !open);
          }}
        >
          Edit
        </Button>
      </div>
      {editing ? (
        <TaskEditor
          event={event}
          task={task}
          onCancel={closeEditor}
          onSave={(next, changed) => {
            const saved = onSave(next, changed);
            if (saved) closeEditor();
            return saved;
          }}
        />
      ) : null}
    </li>
  );
}
