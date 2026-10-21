import { useState, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface ConfirmActionProps {
  /** Text on the button that starts the action. */
  label: string;
  /** Text on the button inside the dialog that confirms it. */
  confirmLabel: string;
  /** Plain-language description of what will happen. */
  message: ReactNode;
  onConfirm: () => void;
  icon?: ReactNode;
  /** Heading of the dialog. Defaults to the button text. */
  title?: string;
  /** Distinguishes repeated triggers for screen readers, e.g. "Delete Demo wedding". */
  accessibleName?: string;
}

/** A button that asks for confirmation in a dialog before doing something destructive. */
export function ConfirmAction({
  label,
  confirmLabel,
  message,
  onConfirm,
  icon,
  title,
  accessibleName,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        icon={icon}
        aria-label={accessibleName}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        title={title ?? accessibleName ?? label}
        confirmLabel={confirmLabel}
        onCancel={() => {
          setOpen(false);
        }}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      >
        {message}
      </ConfirmDialog>
    </>
  );
}
