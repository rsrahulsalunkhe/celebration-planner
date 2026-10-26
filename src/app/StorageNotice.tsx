import { Download, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/Button.tsx';
import { ConfirmAction } from '@/components/ConfirmAction.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import { LIMITS } from '@/domain/primitives.ts';
import { buildJsonExport, buildRecoveryFile, downloadFile } from '@/services/export.ts';
import type { PersistenceStatus } from '@/services/persistence.ts';
import { usePersistence, usePlannerState } from './state/plannerContext.ts';
import styles from './StorageNotice.module.css';

interface Copy {
  headline: string;
  body: ReactNode;
  short: string;
}

function describe(status: Exclude<PersistenceStatus, { kind: 'ready' }>): Copy {
  switch (status.kind) {
    case 'paused-corrupt':
      return {
        headline: 'Saved data could not be read',
        body: (
          <>
            The data saved in this browser is damaged ({status.detail}). Saving is paused
            so it is not overwritten. You can keep working, but new changes will not be
            saved. Download the unreadable data to keep a copy, or clear saved data to
            start fresh.
          </>
        ),
        short: 'Saving is paused because saved data could not be read.',
      };
    case 'paused-too-new':
      return {
        headline: 'Saved data is from a newer version',
        body: (
          <>
            The data saved in this browser was written by a newer version of Celebration
            Planner (format {status.foundVersion}). Saving is paused so it is not
            overwritten. Open the newer version to use it, download a copy, or clear saved
            data to start fresh here.
          </>
        ),
        short: 'Saving is paused because saved data is from a newer version.',
      };
    case 'unavailable':
      return {
        headline: 'This browser is not allowing saving',
        body: (
          <>
            Storage is blocked or unavailable, so your work exists only in this tab and
            will be lost when it closes. Export your events to keep a copy. To try again,
            allow site data for this page and reload.
          </>
        ),
        short: 'Changes are not being saved in this browser.',
      };
    case 'save-failed': {
      const reasons = {
        quota: 'Browser storage is full. Delete events or free up space, then try again.',
        'too-large': `Your events together exceed the ${(LIMITS.payloadChars / 1_000_000).toString()} MB limit for saved data. Delete an event or export a copy, then try again.`,
        unavailable: 'The browser refused the write. It may be blocking site data.',
      } as const;
      return {
        headline: 'Your latest changes were not saved',
        body: <>{reasons[status.reason]} Until then your work stays in this tab only.</>,
        short: 'Your latest changes are not saved.',
      };
    }
  }
}

/** Shows what is wrong with saving and the safe ways to recover. */
export function StorageNotice() {
  const { snapshot, backupText, retrySave, clearSavedData, dismissNotice } =
    usePersistence();
  const state = usePlannerState();
  const [result, setResult] = useState<{ text: string; tone: StatusTone } | null>(null);
  const { status, noticeDismissed } = snapshot;
  const report = (downloaded: boolean, success: string) => {
    setResult(
      downloaded
        ? { text: success, tone: 'success' }
        : {
            text: 'The browser did not start the download. Try again, or check that downloads are allowed for this site.',
            tone: 'error',
          },
    );
  };

  const clearButton = (
    <ConfirmAction
      label="Clear saved data"
      icon={<Trash2 aria-hidden size={18} />}
      confirmLabel="Yes, clear saved data"
      message="This removes the plans Celebration Planner saved in this browser, including the unreadable data, and closes the events open in this tab. Download a copy first if you may need it."
      onConfirm={() => {
        const cleared = clearSavedData();
        setResult(
          cleared
            ? {
                text: 'Saved data cleared. Start a new event, or import a plan file you exported earlier from Your data.',
                tone: 'success',
              }
            : {
                text: 'Could not clear saved data. The browser may be blocking storage.',
                tone: 'error',
              },
        );
      }}
    />
  );

  const resultLine = (
    <StatusMessage message={result?.text} tone={result?.tone ?? 'info'} />
  );

  if (status.kind === 'ready') return <div className={styles.slot}>{resultLine}</div>;

  const copy = describe(status);

  if (noticeDismissed) {
    return (
      <div className={styles.slot}>
        {resultLine}
        <StatusMessage message={copy.short} />
      </div>
    );
  }

  const paused = status.kind === 'paused-corrupt' || status.kind === 'paused-too-new';

  return (
    <div className={styles.slot}>
      {resultLine}
      <ErrorState
        headingLevel="none"
        tone="warning"
        title={copy.headline}
        actions={
          <>
            {status.kind === 'save-failed' ? (
              <Button onClick={retrySave}>Try saving again</Button>
            ) : null}
            {paused && backupText !== null ? (
              <Button
                icon={<Download aria-hidden size={18} />}
                onClick={() => {
                  report(
                    downloadFile(buildRecoveryFile(backupText)),
                    'Unreadable data downloaded as a text file.',
                  );
                }}
              >
                Download saved data
              </Button>
            ) : null}
            {!paused ? (
              <Button
                variant="secondary"
                icon={<Download aria-hidden size={18} />}
                onClick={() => {
                  report(
                    downloadFile(buildJsonExport(state)),
                    'Backup of all events downloaded.',
                  );
                }}
              >
                Export all events (JSON)
              </Button>
            ) : null}
            {paused ? clearButton : null}
            <Button variant="secondary" onClick={dismissNotice}>
              Keep working
            </Button>
          </>
        }
      >
        {copy.body}
      </ErrorState>
    </div>
  );
}
