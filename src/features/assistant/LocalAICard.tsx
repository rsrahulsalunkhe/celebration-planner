import { Cpu, Download, Power, RotateCcw, Square } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import type { LocalModelStatus } from '@/services/ai/local/localModel.ts';
import { LOCAL_MODEL } from '@/services/ai/local/model.ts';
import styles from './Assistant.module.css';
import { useLocalModel } from './localModelContext.ts';

const MB = 1_000_000;
const mb = (bytes: number) => `${Math.round(bytes / MB).toLocaleString('en-IN')} MB`;

const STATUS_TEXT: Record<LocalModelStatus['kind'], string> = {
  idle: 'Off',
  'capability-check': 'Checking this device',
  unsupported: 'Not available on this device',
  'ready-to-download': 'Ready to download',
  downloading: 'Downloading',
  ready: 'Ready',
  generating: 'Writing an answer',
  stopped: 'Stopped',
  error: 'Error',
};

/** Announced once when the state changes; progress updates are not announced. */
const ANNOUNCE: Partial<Record<LocalModelStatus['kind'], string>> = {
  'ready-to-download': 'Device check finished. Review the download before starting.',
  unsupported:
    'Local AI is not available on this device. The guided planner still works.',
  ready: 'Local AI is ready.',
  stopped: 'Local AI stopped.',
  error: 'Local AI failed to load. The guided planner still works.',
};

export function LocalAICard({
  useLocal,
  onUseLocalChange,
}: {
  useLocal: boolean;
  onUseLocalChange: (value: boolean) => void;
}) {
  const { controller, status } = useLocalModel();
  const [announcement, setAnnouncement] = useState('');
  const [lastKind, setLastKind] = useState(status.kind);
  // Announce state changes once, during render; finishing an answer is not news.
  if (status.kind !== lastKind) {
    setLastKind(status.kind);
    const text =
      lastKind === 'generating' && status.kind === 'ready'
        ? undefined
        : ANNOUNCE[status.kind];
    if (text) setAnnouncement(text);
  }

  const enable = (
    <Button
      icon={<Cpu aria-hidden size={18} />}
      onClick={() => {
        void controller.checkDevice();
      }}
    >
      Enable local AI
    </Button>
  );

  return (
    <Card
      title="Local AI (optional)"
      actions={
        <Badge
          tone={
            status.kind === 'ready' || status.kind === 'generating'
              ? 'success'
              : 'neutral'
          }
        >
          {status.kind === 'generating' && status.stopping
            ? 'Stopping'
            : STATUS_TEXT[status.kind]}
        </Badge>
      }
      description={`${LOCAL_MODEL.name}, a small open model (${LOCAL_MODEL.license}) that runs inside this browser with WebGPU. It writes ideas, invitation wording and plain-language explanations. The planner’s rules still handle every cost, total, deadline and change.`}
    >
      <div className="srOnly" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className={styles.intro}>
        {status.kind === 'idle' ? (
          <>
            <p>
              Nothing is downloaded until you choose to. Enabling it first checks this
              browser and graphics card, then shows the download before it starts. It
              needs a separate model download of several hundred megabytes and enough
              graphics memory (about 1.5 GB).
            </p>
            <p className={styles.muted}>
              Your event details stay in this browser and are never sent to an AI service.
              The model files themselves are served by third parties (
              {LOCAL_MODEL.hosts.join(' and ')}), which see that a download was requested
              but not your event.
            </p>
            <div className={styles.buttons}>{enable}</div>
          </>
        ) : null}

        {status.kind === 'capability-check' ? (
          <>
            <p>Checking this browser and graphics card…</p>
            <div className={styles.buttons}>
              <Button
                variant="secondary"
                onClick={() => {
                  controller.stop();
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : null}

        {status.kind === 'unsupported' ? (
          <>
            <p>Local AI cannot run here:</p>
            <ul>
              {status.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p>The guided planner below keeps working as before.</p>
            <div className={styles.buttons}>
              <Button
                variant="secondary"
                icon={<RotateCcw aria-hidden size={16} />}
                onClick={() => {
                  void controller.checkDevice();
                }}
              >
                Check again
              </Button>
            </div>
          </>
        ) : null}

        {status.kind === 'ready-to-download' ? (
          <>
            <p>
              {status.estimate.cached
                ? 'The model is already in this browser’s storage, so it loads without a large download.'
                : status.estimate.verifiedBytes !== null
                  ? `Download: about ${mb(status.estimate.verifiedBytes)} of model weights (from the model’s own file list), plus a few megabytes for the tokenizer and model library.`
                  : 'The download size could not be checked. Expect a large download, several hundred megabytes, before you start.'}
            </p>
            <ul>
              <li>
                Model: {status.estimate.modelId} (
                <a href={LOCAL_MODEL.source} target="_blank" rel="noreferrer">
                  source
                </a>
                ,{' '}
                <a href={LOCAL_MODEL.licenseUrl} target="_blank" rel="noreferrer">
                  {LOCAL_MODEL.license} license
                </a>
                ).
              </li>
              <li>
                Downloaded from {LOCAL_MODEL.hosts.join(' and ')}, then kept in this
                browser’s storage.
              </li>
              {status.capability.adapter ? (
                <li>Graphics: {status.capability.adapter}.</li>
              ) : null}
              {status.capability.freeStorageBytes !== null ? (
                <li>
                  Browser storage available: about{' '}
                  {mb(status.capability.freeStorageBytes)}.
                </li>
              ) : null}
              {status.capability.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <div className={styles.buttons}>
              <Button
                icon={<Download aria-hidden size={18} />}
                onClick={() => {
                  void controller.download();
                }}
              >
                {status.estimate.cached ? 'Load the model' : 'Download and start'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  controller.stop();
                }}
              >
                Not now
              </Button>
            </div>
          </>
        ) : null}

        {status.kind === 'downloading' ? (
          <>
            <label htmlFor="local-ai-progress">
              Loading {status.modelId}: {Math.round(status.progress * 100)}%
            </label>
            <progress id="local-ai-progress" max={1} value={status.progress} />
            <p className={styles.muted}>{status.text}</p>
            <div className={styles.buttons}>
              <Button
                variant="secondary"
                icon={<Square aria-hidden size={16} />}
                onClick={() => {
                  controller.stop();
                }}
              >
                Stop download
              </Button>
            </div>
          </>
        ) : null}

        {status.kind === 'ready' || status.kind === 'generating' ? (
          <>
            <p>
              {status.kind === 'generating'
                ? status.stopping
                  ? 'Stopping. The model first finishes reading the request (this step cannot be interrupted), then stops at its next word. The cancelled answer will not be shown.'
                  : 'Local AI is writing an answer. Use Stop in the conversation to stop it.'
                : `Local AI is ready (${status.modelId}), running on this device.`}
            </p>
            <Checkbox
              label="Use local AI for ideas, invitation wording and explanations"
              checked={useLocal}
              onChange={onUseLocalChange}
            />
            <div className={styles.buttons}>
              <Button
                variant="secondary"
                icon={<Power aria-hidden size={16} />}
                onClick={() => {
                  void controller.unload();
                }}
              >
                Turn off local AI
              </Button>
            </div>
          </>
        ) : null}

        {status.kind === 'stopped' ? (
          <>
            <p>{status.message}</p>
            <div className={styles.buttons}>{enable}</div>
          </>
        ) : null}

        {status.kind === 'error' ? (
          <>
            <p>{status.message}</p>
            <p>The guided planner below keeps working as before.</p>
            <div className={styles.buttons}>
              <Button
                variant="secondary"
                icon={<RotateCcw aria-hidden size={16} />}
                onClick={() => {
                  void controller.checkDevice();
                }}
              >
                Try again
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
