import { ListPlus, Plus, Star, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { useCalendar, usePlannerDispatch } from '@/app/state/plannerContext.ts';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { CheckboxGroup } from '@/components/CheckboxGroup.tsx';
import { toOptions, type Option } from '@/components/options.ts';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Select } from '@/components/Select.tsx';
import { Stack } from '@/components/Stack.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import { TextField } from '@/components/TextField.tsx';
import {
  AGE_BAND_LABELS,
  EVENT_TYPE_LABELS,
  PRIORITY_LABELS,
  SETTING_LABELS,
} from '@/data/labels.ts';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { formatDate } from '@/domain/dates.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { createId } from '@/domain/ids.ts';
import { buildLedger } from '@/domain/planning/budget.ts';
import {
  SOURCE_LABELS,
  defaultIdeaFilters,
  ideaFromSuggestion,
  ideaTaskOperations,
  sourceOf,
  suggestIdeas,
  taskPlanFor,
  type BudgetFilter,
  type IdeaFilters,
  type Suggestion,
} from '@/domain/planning/ideas.ts';
import { IDEA_KINDS, LIMITS } from '@/domain/primitives.ts';
import { ideaSchema } from '@/domain/schemas.ts';
import type {
  ChangeOperation,
  EventRecord,
  EventType,
  Idea,
  Priority,
} from '@/domain/types.ts';
import styles from './Ideas.module.css';

const CONFIG = PLANNING_CONFIGURATION;

const KIND_LABELS: Record<Idea['kind'], string> = {
  theme: 'Theme',
  activity: 'Activity',
  decor: 'Decor',
  food: 'Food',
  favour: 'Favour',
};
const KIND_OPTIONS = IDEA_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));
const EVENT_TYPE_OPTIONS = toOptions(EVENT_TYPE_LABELS);
const BUDGET_OPTIONS: Option<BudgetFilter>[] = [
  { value: 'any', label: 'Any cost level' },
  { value: 'medium', label: 'Low or medium cost' },
  { value: 'low', label: 'Low cost only' },
];
const PRIORITY_OPTIONS = toOptions(PRIORITY_LABELS);

export function IdeasPage() {
  return (
    <ActiveEventGate title="Ideas">
      {(event) => <IdeasWorkspace key={event.profile.id} event={event} />}
    </ActiveEventGate>
  );
}

function IdeasWorkspace({ event }: { event: EventRecord }) {
  const dispatch = usePlannerDispatch();
  const today = useCalendar().today();
  const [filters, setFilters] = useState<IdeaFilters>(() => defaultIdeaFilters(event));
  const [message, setMessage] = useState<{ text: string; tone: StatusTone } | null>(null);
  const { profile, preferences } = event;

  const commit = (operations: readonly ChangeOperation[], success: string): boolean => {
    if (operations.length === 0) {
      setMessage({ text: success, tone: 'info' });
      return true;
    }
    if (!applyOperations(event, operations)) {
      setMessage({
        text: `That could not be saved. An event can hold up to ${LIMITS.ideas} ideas and ${LIMITS.tasks} tasks.`,
        tone: 'error',
      });
      return false;
    }
    dispatch({
      type: 'event/edit',
      eventId: profile.id,
      operations,
      expectedRevision: profile.revision,
    });
    setMessage({ text: success, tone: 'success' });
    return true;
  };

  const set = <K extends keyof IdeaFilters>(key: K, value: IdeaFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const result = suggestIdeas(event, today, CONFIG, filters);
  const saved = event.ideas.filter((i) => i.status === 'saved' || i.favorite === true);
  const overBudget =
    event.budgetCategories.length > 0 && buildLedger(event, CONFIG).headroomPaise < 0;

  const addTask = (idea: Idea) => {
    const outcome = ideaTaskOperations(
      event,
      idea,
      taskPlanFor(idea, CONFIG, profile.eventType),
      today,
    );
    if (!outcome.ok) {
      setMessage({ text: outcome.reason, tone: 'error' });
      return;
    }
    commit(
      outcome.operations,
      outcome.created
        ? `Added the task “${outcome.task.title}”, due ${formatDate(outcome.task.dueDate)}. No cost was added to the budget.`
        : `“${outcome.task.title}” is already on the timeline, so nothing was added.`,
    );
  };

  const saveSuggestion = (s: Suggestion, favorite: boolean) => {
    commit(
      [{ op: 'ideas/upsert', item: ideaFromSuggestion(event, s, favorite) }],
      favorite
        ? `Saved “${s.title}” as a favourite.`
        : `Saved “${s.title}” to your ideas.`,
    );
  };

  const taskFor = (idea: Idea) =>
    idea.taskId ? (event.tasks.find((t) => t.id === idea.taskId) ?? null) : null;

  return (
    <>
      <PageHeader
        title="Ideas"
        description={`For ${profile.title}. Suggestions that fit this event, Local AI drafts you saved, and your own ideas.`}
      />
      <Stack>
        <StatusMessage message={message?.text} tone={message?.tone ?? 'info'} />

        <Card
          title="Your ideas"
          description="Saved ideas, with where each came from. Starred ideas appear as chosen ideas in the printed plan."
        >
          {saved.length === 0 ? (
            <p className={styles.muted}>
              Nothing saved yet. Save a suggestion below, add your own, or save a Local AI
              draft from the Assistant.
            </p>
          ) : (
            <ul className={styles.list}>
              {saved.map((idea) => {
                const task = taskFor(idea);
                return (
                  <li key={idea.id} className={styles.item}>
                    <h3>{idea.title}</h3>
                    <div className={styles.badges}>
                      <Badge
                        tone={
                          sourceOf(idea) === 'local-ai'
                            ? 'gold'
                            : sourceOf(idea) === 'user'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {SOURCE_LABELS[sourceOf(idea)]}
                      </Badge>
                      <Badge>{KIND_LABELS[idea.kind]}</Badge>
                      {idea.favorite ? <Badge tone="navy">Favourite</Badge> : null}
                    </div>
                    {idea.details ? <p>{idea.details}</p> : null}
                    {idea.reason ? <p className={styles.muted}>{idea.reason}</p> : null}
                    {task ? (
                      <p>
                        On the timeline: “{task.title}”, due {formatDate(task.dueDate)} (
                        <Link to="/timeline">open the Timeline</Link>).
                      </p>
                    ) : null}
                    <div className={styles.buttons}>
                      <Button
                        variant={idea.favorite ? 'primary' : 'secondary'}
                        icon={<Star aria-hidden size={16} />}
                        aria-pressed={idea.favorite === true}
                        aria-label={`Favourite “${idea.title}”`}
                        onClick={() => {
                          commit(
                            [
                              {
                                op: 'ideas/upsert',
                                item: {
                                  ...idea,
                                  status: 'saved',
                                  favorite: !idea.favorite,
                                },
                              },
                            ],
                            idea.favorite
                              ? `“${idea.title}” is no longer a favourite.`
                              : `“${idea.title}” is now a favourite.`,
                          );
                        }}
                      >
                        Favourite
                      </Button>
                      {task ? null : (
                        <Button
                          variant="secondary"
                          icon={<ListPlus aria-hidden size={16} />}
                          aria-label={`Add “${idea.title}” as a task`}
                          onClick={() => {
                            addTask(idea);
                          }}
                        >
                          Add as a task
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        icon={<Trash2 aria-hidden size={16} />}
                        aria-label={`Remove “${idea.title}” from your ideas`}
                        onClick={() => {
                          commit(
                            [{ op: 'ideas/remove', itemId: idea.id }],
                            task
                              ? `Removed “${idea.title}”. Its task stays on the timeline.`
                              : `Removed “${idea.title}”.`,
                          );
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <AddIdeaCard commit={commit} atLimit={event.ideas.length >= LIMITS.ideas} />

        <Card
          title="Suggestions"
          description="From the planner’s built-in list, filtered by this event’s details and your choices. Each says why it fits."
        >
          {overBudget ? (
            <p className={styles.note}>
              Your forecast is above the budget after the reserve. Consider “Low cost
              only”.
            </p>
          ) : null}
          <div className={styles.filters}>
            <Select
              name="ideas-type"
              label="Event type"
              value={filters.eventType}
              options={EVENT_TYPE_OPTIONS}
              onChange={(v: EventType | '') => {
                if (v) set('eventType', v);
              }}
            />
            <Select
              name="ideas-budget"
              label="Cost level"
              value={filters.budget}
              options={BUDGET_OPTIONS}
              onChange={(v) => {
                if (v) set('budget', v);
              }}
            />
            <Select
              name="ideas-setting"
              label="Setting"
              value={filters.setting}
              options={[
                {
                  value: 'event',
                  label: `This event’s (${SETTING_LABELS[profile.setting].toLowerCase()})`,
                },
                { value: 'any', label: 'Any setting' },
              ]}
              onChange={(v) => {
                if (v) set('setting', v);
              }}
            />
            <div className={styles.wide}>
              <Checkbox
                label={`Only ideas ready in the time left (${result.daysUntilEvent >= 0 ? `${result.daysUntilEvent} days` : 'the event has passed'})`}
                checked={filters.fitTime}
                onChange={(v) => {
                  set('fitTime', v);
                }}
              />
              {profile.ageBand ? (
                <Checkbox
                  label={`Only ideas for a guest of honour aged ${AGE_BAND_LABELS[profile.ageBand].toLowerCase()}`}
                  checked={filters.ageBand}
                  onChange={(v) => {
                    set('ageBand', v);
                  }}
                />
              ) : null}
              {preferences.dietaryNeeds.length > 0 ? (
                <Checkbox
                  label="Only food ideas that suit every stated dietary need"
                  checked={filters.diet}
                  onChange={(v) => {
                    set('diet', v);
                  }}
                />
              ) : null}
              {preferences.accessibilityNeeds.length > 0 ? (
                <Checkbox
                  label="Leave out ideas that are a poor fit for stated access needs"
                  checked={filters.access}
                  onChange={(v) => {
                    set('access', v);
                  }}
                />
              ) : null}
            </div>
            <div className={styles.wide}>
              <CheckboxGroup
                name="ideas-preferences"
                legend="Only ideas for these preferences (optional)"
                options={PRIORITY_OPTIONS}
                selected={filters.preferences}
                onChange={(v: Priority[]) => {
                  set('preferences', v);
                }}
              />
            </div>
          </div>
          <p className={styles.muted} role="status" aria-live="polite">
            Showing {result.shown.length} of {result.shown.length + result.hidden.length}{' '}
            suggestions.
          </p>

          <ul className={styles.list}>
            {result.shown.map((s) => (
              <li key={s.templateId} className={styles.item}>
                <h3>{s.title}</h3>
                <div className={styles.badges}>
                  <Badge>{SOURCE_LABELS.guided}</Badge>
                  <Badge>{KIND_LABELS[s.kind]}</Badge>
                  <Badge>Effort: {s.effort}</Badge>
                  <Badge>About {s.leadDays} days to prepare</Badge>
                  {s.saved ? <Badge tone="success">Saved</Badge> : null}
                  {s.saved?.favorite ? <Badge tone="navy">Favourite</Badge> : null}
                </div>
                <p>{s.details}</p>
                <ul className={styles.reasons} aria-label={`Why “${s.title}” fits`}>
                  {s.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className={styles.cost}>
                  {s.cost
                    ? s.cost.text
                    : 'No cost estimate: the planner has no rate for this idea.'}
                </p>
                {s.eventType === profile.eventType ? (
                  <div className={styles.buttons}>
                    {s.saved ? null : (
                      <Button
                        variant="secondary"
                        aria-label={`Save “${s.title}”`}
                        onClick={() => {
                          saveSuggestion(s, false);
                        }}
                      >
                        Save
                      </Button>
                    )}
                    <Button
                      variant={s.saved?.favorite ? 'primary' : 'secondary'}
                      icon={<Star aria-hidden size={16} />}
                      aria-pressed={s.saved?.favorite === true}
                      aria-label={`Favourite “${s.title}”`}
                      onClick={() => {
                        saveSuggestion(s, !s.saved?.favorite);
                      }}
                    >
                      Favourite
                    </Button>
                    <Button
                      variant="secondary"
                      icon={<ListPlus aria-hidden size={16} />}
                      aria-label={`Add “${s.title}” as a task`}
                      onClick={() => {
                        addTask(ideaFromSuggestion(event, s, s.saved?.favorite ?? false));
                      }}
                    >
                      {s.saved?.taskId ? 'Task added' : 'Add as a task'}
                    </Button>
                  </div>
                ) : (
                  <p className={styles.muted}>
                    Shown for reference: switch back to{' '}
                    {EVENT_TYPE_LABELS[profile.eventType].toLowerCase()} to save ideas for
                    this event.
                  </p>
                )}
              </li>
            ))}
          </ul>
          {result.shown.length === 0 ? (
            <p className={styles.muted}>No suggestions match these filters.</p>
          ) : null}
          {result.hidden.length > 0 ? (
            <details className={styles.hidden}>
              <summary>Not shown ({result.hidden.length}), with reasons</summary>
              <ul className={styles.reasons}>
                {result.hidden.map((h) => (
                  <li key={h.templateId}>
                    <strong>{h.title}:</strong> {h.reasons.join(' ')}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      </Stack>
    </>
  );
}

function AddIdeaCard({
  commit,
  atLimit,
}: {
  commit: (operations: readonly ChangeOperation[], success: string) => boolean;
  atLimit: boolean;
}) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [kind, setKind] = useState<Idea['kind']>('activity');
  const [error, setError] = useState<string | undefined>();

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const trimmed = details.trim();
    const parsed = ideaSchema.safeParse({
      id: createId('idea'),
      title,
      ...(trimmed ? { details: trimmed } : {}),
      kind,
      status: 'saved',
      source: 'user',
      favorite: false,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues.find((i) => i.path[0] === 'title')?.message ??
          'Check the idea',
      );
      document.getElementById('field-own-idea-title')?.focus();
      return;
    }
    if (
      commit(
        [{ op: 'ideas/upsert', item: parsed.data }],
        `Added your idea “${parsed.data.title}”.`,
      )
    ) {
      setTitle('');
      setDetails('');
      setError(undefined);
    }
  };

  return (
    <Card title="Add your own idea">
      <form
        className={styles.form}
        onSubmit={submit}
        noValidate
        aria-label="Add your own idea"
      >
        <TextField
          name="own-idea-title"
          label="Idea"
          value={title}
          maxLength={100}
          required
          autoComplete="off"
          error={error}
          onChange={(v) => {
            setTitle(v);
            setError(undefined);
          }}
        />
        <Select
          name="own-idea-kind"
          label="Kind"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(v) => {
            if (v) setKind(v);
          }}
        />
        <div className={styles.wide}>
          <TextField
            name="own-idea-details"
            label="Details (optional)"
            value={details}
            multiline
            maxLength={500}
            onChange={setDetails}
          />
        </div>
        <div className={`${styles.buttons} ${styles.wide}`}>
          <Button type="submit" icon={<Plus aria-hidden size={18} />} disabled={atLimit}>
            Add idea
          </Button>
        </div>
      </form>
    </Card>
  );
}
