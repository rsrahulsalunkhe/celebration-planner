import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button.tsx';
import { CheckboxGroup } from '@/components/CheckboxGroup.tsx';
import { toOptions, type Option } from '@/components/options.ts';
import { Select } from '@/components/Select.tsx';
import { TextField } from '@/components/TextField.tsx';
import { IMPORTANCE_LABELS, TASK_CATEGORY_LABELS } from '@/data/labels.ts';
import { formatDate } from '@/domain/dates.ts';
import { createId } from '@/domain/ids.ts';
import { KIND_LABELS } from '@/domain/planning/timeline.ts';
import type { EventRecord, PlanningTask, TaskKind } from '@/domain/types.ts';
import styles from './Timeline.module.css';
import {
  TASK_FIELD_ORDER,
  parseTaskForm,
  valuesFromTask,
  type TaskField,
  type TaskFormErrors,
  type TaskFormValues,
} from './taskForm.ts';

const KIND_OPTIONS = toOptions(KIND_LABELS);
const CATEGORY_OPTIONS = toOptions(TASK_CATEGORY_LABELS);
const IMPORTANCE_OPTIONS = toOptions(IMPORTANCE_LABELS);

interface TaskEditorProps {
  event: EventRecord;
  /** `null` adds a custom task. */
  task: PlanningTask | null;
  onSave: (task: PlanningTask, deadlineChanged: boolean) => boolean;
  onCancel: () => void;
}

/**
 * Adds a custom task or edits one. For a generated task only the deadline,
 * owner and notes can change: its title, kind and prerequisites come from the
 * plan. A changed deadline becomes a manual override.
 */
export function TaskEditor({ event, task, onSave, onCancel }: TaskEditorProps) {
  const prefix = task ? `task-${task.id}` : 'new-task';
  const generated = task?.templateId !== undefined;
  const eventDate = event.profile.date;
  const [values, setValues] = useState<TaskFormValues>(() =>
    valuesFromTask(task, 'preparation'),
  );
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const field = (name: TaskField) => `${prefix}-${name}`;

  const firstField = `field-${prefix}-${generated ? 'dueDate' : 'title'}`;
  useEffect(() => {
    document.getElementById(firstField)?.focus();
  }, [firstField]);

  const set = <K extends TaskField>(name: K, value: TaskFormValues[K]) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const result = parseTaskForm(values, {
      existing: task,
      newId: createId('task'),
      eventDate,
      allTasks: event.tasks,
    });
    if (!result.ok) {
      setErrors(result.errors);
      const first = TASK_FIELD_ORDER.find((f) => result.errors[f]);
      if (first) document.getElementById(`field-${field(first)}`)?.focus();
      return;
    }
    onSave(result.task, result.deadlineChanged);
  };

  const prerequisiteOptions: Option[] = event.tasks
    .filter((t) => t.id !== task?.id)
    .map((t) => ({ value: t.id, label: t.title }));

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      noValidate
      aria-label={task ? `Edit “${task.title}”` : 'Add your own task'}
    >
      {generated ? (
        <p className={`${styles.muted} ${styles.wide}`}>
          This step comes from the plan. Changing its deadline makes it a manual deadline:
          it is kept when the plan is recalculated, and flagged for review if the event
          date changes.
        </p>
      ) : (
        <>
          <div className={styles.wide}>
            <TextField
              name={field('title')}
              label="Task"
              value={values.title}
              maxLength={120}
              required
              autoComplete="off"
              error={errors.title}
              onChange={(v) => {
                set('title', v);
              }}
            />
          </div>
          <Select
            name={field('kind')}
            label="When"
            value={values.kind}
            options={KIND_OPTIONS}
            onChange={(v: TaskKind | '') => {
              if (v) set('kind', v);
            }}
          />
        </>
      )}
      {values.kind === 'event-day' || (generated && task.kind === 'event-day') ? (
        <p className={styles.muted}>Due on the event day, {formatDate(eventDate)}.</p>
      ) : (
        <TextField
          name={field('dueDate')}
          label="Deadline"
          type="date"
          required
          value={values.dueDate}
          hint={
            values.kind === 'follow-up'
              ? `After the event on ${formatDate(eventDate)}`
              : `On or before the event on ${formatDate(eventDate)}`
          }
          error={errors.dueDate}
          onChange={(v) => {
            set('dueDate', v);
          }}
        />
      )}
      {!generated ? (
        <>
          <Select
            name={field('category')}
            label="Category"
            value={values.category}
            options={CATEGORY_OPTIONS}
            placeholder="No category"
            onChange={(v) => {
              set('category', v);
            }}
          />
          <Select
            name={field('importance')}
            label="Importance"
            value={values.importance}
            options={IMPORTANCE_OPTIONS}
            onChange={(v) => {
              if (v) set('importance', v);
            }}
          />
        </>
      ) : null}
      <TextField
        name={field('owner')}
        label="Organizer or volunteer"
        value={values.owner}
        maxLength={60}
        autoComplete="off"
        hint="A label for who looks after it. Nobody is contacted."
        error={errors.owner}
        onChange={(v) => {
          set('owner', v);
        }}
      />
      <div className={styles.wide}>
        <TextField
          name={field('notes')}
          label="Notes"
          value={values.notes}
          multiline
          maxLength={500}
          error={errors.notes}
          onChange={(v) => {
            set('notes', v);
          }}
        />
      </div>
      {!generated && prerequisiteOptions.length > 0 ? (
        <div className={styles.wide}>
          <CheckboxGroup
            name={field('dependsOn')}
            legend="Do these first (optional)"
            options={prerequisiteOptions}
            selected={values.dependsOn}
            error={errors.dependsOn}
            onChange={(v) => {
              set('dependsOn', v);
            }}
          />
        </div>
      ) : null}
      <div className={`${styles.buttons} ${styles.wide}`}>
        <Button type="submit">{task ? 'Save task' : 'Add task'}</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
