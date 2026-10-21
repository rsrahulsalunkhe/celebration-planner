import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usePersistence, usePlannerState } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { LIMITS } from '@/domain/primitives.ts';
import { buildJsonExport, downloadFile } from '@/services/export.ts';
import type { PersistenceStatus } from '@/services/persistence.ts';
import styles from './DataPage.module.css';

const STATUS_TEXT: Record<PersistenceStatus['kind'], string> = {
  ready: 'On. Changes are saved in this browser as you make them.',
  'paused-corrupt': 'Paused. Existing saved data is unreadable and is being protected.',
  'paused-too-new':
    'Paused. Existing saved data is from a newer version and is being protected.',
  unavailable: 'Off. This browser is not allowing saving.',
  'save-failed': 'Failing. Your latest changes are not saved.',
};

export function DataPage() {
  const state = usePlannerState();
  const { snapshot, clearSavedData } = usePersistence();
  const [result, setResult] = useState<{ text: string; problem: boolean } | null>(null);

  return (
    <>
      <PageHeader
        title="Your data"
        description="Where your plans are kept, and how to export or remove them."
      />

      <section className={styles.section} aria-labelledby="where">
        <h2 id="where">Where your data lives</h2>
        <ul className={styles.list}>
          <li>
            Everything is saved in this browser on this device (its local storage).
            Nothing is sent to a server and there is no account.
          </li>
          <li>
            The data is <strong>not encrypted</strong>. Anyone who can use this browser
            profile can read it, so avoid shared computers.
          </li>
          <li>
            It does not follow you to other browsers or devices, and clearing your
            browser’s site data removes it. Export a copy to back it up.
          </li>
          <li>Assistant chat is not saved. It exists only while this tab is open.</li>
          <li>
            Limits: up to {LIMITS.events} events, and about{' '}
            {(LIMITS.payloadChars / 1_000_000).toString()} MB of saved data in total.
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="status">
        <h2 id="status">Saving status</h2>
        <p>{STATUS_TEXT[snapshot.status.kind]}</p>
        <p>
          {state.events.length} of {LIMITS.events} events in this session.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="actions">
        <h2 id="actions">Export or clear</h2>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            icon={<Download aria-hidden size={18} />}
            onClick={() => {
              downloadFile(buildJsonExport(state));
            }}
          >
            Export all events (JSON)
          </Button>
          <ConfirmAction
            label="Clear saved data"
            icon={<Trash2 aria-hidden size={18} />}
            confirmLabel="Yes, clear saved data"
            message="This removes everything Celebration Planner saved in this browser and closes the events open in this tab. Other websites’ data is not touched. This cannot be undone."
            onConfirm={() => {
              setResult(
                clearSavedData()
                  ? { text: 'Saved data cleared.', problem: false }
                  : {
                      text: 'Could not clear saved data. The browser may be blocking storage.',
                      problem: true,
                    },
              );
            }}
          />
        </div>
        <div role="status" className={styles.result} data-problem={result?.problem}>
          {result?.text}
        </div>
      </section>
    </>
  );
}
