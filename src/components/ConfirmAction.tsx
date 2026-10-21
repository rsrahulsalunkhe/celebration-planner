import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import styles from './ConfirmAction.module.css';

interface ConfirmActionProps {
  /** Text on the button that starts the action. */
  label: string;
  /** Text on the button that confirms it. */
  confirmLabel: string;
  /** Plain-language description of what will happen. */
  message: ReactNode;
  onConfirm: () => void;
  icon?: ReactNode;
  /** Distinguishes repeated triggers for screen readers, e.g. "Delete Demo wedding". */
  accessibleName?: string;
}

/**
 * Two-step destructive action. Nothing happens until the user presses the
 * confirm button; Cancel (or Escape) backs out and returns focus to the trigger.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  message,
  onConfirm,
  icon,
  accessibleName,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    // Wait for the trigger to render again before moving focus back to it.
    queueMicrotask(() => triggerRef.current?.focus());
  };

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        variant="secondary"
        icon={icon}
        aria-label={accessibleName}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={messageId}
      className={styles.panel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <p id={messageId} className={styles.message}>
        {message}
      </p>
      <div className={styles.actions}>
        <Button
          ref={confirmRef}
          variant="danger"
          onClick={() => {
            setOpen(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
