import { FileUp } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { usePlannerDispatch, usePlannerState } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import { StatusMessage } from '@/components/StatusMessage.tsx';
import { EVENT_TYPE_LABELS } from '@/data/labels.ts';
import { formatDate } from '@/domain/dates.ts';
import { createId } from '@/domain/ids.ts';
import { copyWithNewIds } from '@/domain/importCopy.ts';
import { LIMITS } from '@/domain/primitives.ts';
import type { EventRecord } from '@/domain/types.ts';
import {
  MAX_IMPORT_BYTES,
  checkImportSize,
  parseImportText,
  type ImportResult,
} from '@/services/importPlan.ts';
import styles from './DataPage.module.css';

type Preview = Extract<ImportResult, { ok: true }> & { fileName: string };
interface Problem {
  title: string;
  details: string[];
}

const plural = (n: number, word: string) =>
  `${n.toString()} ${word}${n === 1 ? '' : 's'}`;

function summaryOf(record: EventRecord): string {
  return [
    plural(record.tasks.length, 'task'),
    plural(record.expenses.length, 'budget line'),
    plural(record.vendors.length, 'vendor'),
    plural(record.ideas.length, 'idea'),
    plural(record.guests.length, 'guest party'),
  ].join(', ');
}

/**
 * Reads a plan file into a preview. Nothing changes until the user chooses
 * "Import as a copy" (always new ids) or, for a single event already here,
 * confirms replacing it. A matching id alone never replaces anything.
 */
export function ImportCard() {
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const readFile = async (file: File) => {
    setDone(null);
    setPreview(null);
    const tooBig = checkImportSize(file.size);
    if (tooBig) {
      setProblem({ title: 'This file is too large', details: [tooBig] });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setProblem({
        title: 'The file could not be read',
        details: ['Try choosing it again.'],
      });
      return;
    }
    const result = parseImportText(text);
    if (!result.ok) {
      setProblem({ title: result.title, details: result.details });
      return;
    }
    setProblem(null);
    setPreview({ ...result, fileName: file.name });
  };

  const room = LIMITS.events - state.events.length;
  const single = preview?.kind === 'event' ? preview.events[0] : undefined;
  const existing = single
    ? state.events.find((e) => e.profile.id === single.profile.id)
    : undefined;

  const importCopies = () => {
    if (!preview) return;
    if (preview.events.length > room) {
      setProblem({
        title: 'There is no room for these events',
        details: [
          `You can keep up to ${LIMITS.events.toString()} events and have ${state.events.length.toString()}. Delete an event first.`,
        ],
      });
      return;
    }
    // A copy beside an event of the same name is told apart in the event switcher.
    const taken = new Set(state.events.map((e) => e.profile.title));
    const copies = preview.events.map((e) => {
      const title = taken.has(e.profile.title)
        ? `${e.profile.title.slice(0, 93)} (copy)`
        : e.profile.title;
      return copyWithNewIds(
        { ...e, profile: { ...e.profile, title } },
        createId('event'),
        createId,
      );
    });
    if (copies.some((c) => c === null)) {
      setProblem({
        title: 'The plan could not be copied',
        details: ['Nothing was imported.'],
      });
      return;
    }
    for (const copy of copies) if (copy) dispatch({ type: 'event/import', record: copy });
    setDone(
      copies.length === 1
        ? `Imported “${copies[0]?.profile.title ?? ''}” as a new event. It is now the open event.`
        : `Imported ${copies.length.toString()} events as new events.`,
    );
    reset();
  };

  return (
    <Card title="Import a plan">
      <p className={styles.help}>
        Choose a plan file (.json) exported from Celebration Planner, up to{' '}
        {(MAX_IMPORT_BYTES / 1_000_000).toString()} MB. You will see what is in it before
        anything changes. Full backups from “Export all events” work too.
      </p>
      <label htmlFor={inputId} className={styles.fileLabel}>
        <FileUp aria-hidden size={18} /> Plan file
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".json,application/json"
        className={styles.file}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readFile(file);
        }}
      />

      {problem && (
        <div role="alert" className={styles.problem}>
          <p>
            <strong>{problem.title}.</strong> Your saved plans have not changed.
          </p>
          {problem.details.length > 0 && (
            <ul>
              {problem.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <section aria-labelledby={`${inputId}-preview`} className={styles.preview}>
          <h3 id={`${inputId}-preview`}>Preview of {preview.fileName}</h3>
          <p>
            {preview.kind === 'event' ? 'A plan file' : 'A full backup'}
            {preview.exportedAt ? `, exported ${preview.exportedAt.slice(0, 10)}` : ''},
            with {plural(preview.events.length, 'event')}:
          </p>
          <ul className={styles.previewList}>
            {preview.events.map((e) => (
              <li key={e.profile.id}>
                <strong>{e.profile.title}</strong> —{' '}
                {EVENT_TYPE_LABELS[e.profile.eventType]}, {formatDate(e.profile.date)},{' '}
                {e.profile.city}, {plural(e.profile.guestCount, 'guest')}. {summaryOf(e)}.
              </li>
            ))}
          </ul>
          {preview.notImported.map((n) => (
            <p key={n} className={styles.help}>
              {n}
            </p>
          ))}
          {existing && (
            <p className={styles.help}>
              This file is a version of “{existing.profile.title}”, which is already here.
              Importing a copy keeps both. Replacing overwrites the one here.
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="primary" onClick={importCopies}>
              {preview.events.length === 1 ? 'Import as a copy' : 'Import as copies'}
            </Button>
            {single && existing && (
              <ConfirmAction
                label={`Replace “${existing.profile.title}”`}
                confirmLabel="Yes, replace it"
                message={`This replaces everything in “${existing.profile.title}” (${summaryOf(existing)}) with the imported plan (${summaryOf(single)}). This cannot be undone. Export it first if you may want it back.`}
                onConfirm={() => {
                  dispatch({
                    type: 'event/replace',
                    record: single,
                    expectedRevision: existing.profile.revision,
                  });
                  setDone(`Replaced “${existing.profile.title}” with the imported plan.`);
                  reset();
                }}
              />
            )}
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                setDone('Import cancelled. Nothing changed.');
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
      <StatusMessage message={done} tone="success" />
    </Card>
  );
}
