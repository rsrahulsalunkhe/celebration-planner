import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usePersistence, usePlannerState } from '@/app/state/plannerContext.ts';
import { Badge, type BadgeTone } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import { LIMITS } from '@/domain/primitives.ts';
import { buildJsonExport, downloadFile } from '@/services/export.ts';
import type { PersistenceStatus } from '@/services/persistence.ts';
import styles from './DataPage.module.css';

const STATUS: Record<
  PersistenceStatus['kind'],
  { tone: BadgeTone; label: string; text: string }
> = {
  ready: {
    tone: 'success',
    label: 'Saving on',
    text: 'Changes are saved in this browser as you make them.',
  },
  'paused-corrupt': {
    tone: 'coral',
    label: 'Saving paused',
    text: 'Existing saved data is unreadable and is being protected.',
  },
  'paused-too-new': {
    tone: 'coral',
    label: 'Saving paused',
    text: 'Existing saved data is from a newer version and is being protected.',
  },
  unavailable: {
    tone: 'coral',
    label: 'Saving off',
    text: 'This browser is not allowing saving.',
  },
  'save-failed': {
    tone: 'coral',
    label: 'Saving failing',
    text: 'Your latest changes are not saved.',
  },
};

export function DataPage() {
  const state = usePlannerState();
  const { snapshot, clearSavedData } = usePersistence();
  const [result, setResult] = useState<{ text: string; tone: StatusTone } | null>(null);
  const status = STATUS[snapshot.status.kind];

  return (
    <>
      <PageHeader
        title="Your data"
        description="Where your plans are kept, and how to export or remove them."
      />
      <Stack>
        <Card title="Where your data lives">
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
        </Card>

        <Card title="Saving status">
          <p className={styles.status}>
            <Badge tone={status.tone}>{status.label}</Badge> {status.text}
          </p>
          <p className={styles.count}>
            {state.events.length} of {LIMITS.events} events in this session.
          </p>
        </Card>

        <Card title="Export or clear">
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
                    ? { text: 'Saved data cleared.', tone: 'success' }
                    : {
                        text: 'Could not clear saved data. The browser may be blocking storage.',
                        tone: 'error',
                      },
                );
              }}
            />
          </div>
          <StatusMessage message={result?.text} tone={result?.tone ?? 'info'} />
        </Card>
      </Stack>
    </>
  );
}
