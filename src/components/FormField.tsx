import type { ReactNode } from 'react';
import styles from './Fields.module.css';

/** What a control needs to be correctly labelled and described. */
export interface FieldControlProps {
  id: string;
  required: boolean;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

interface FormFieldProps {
  /** Becomes the control's id (`field-<name>`), which forms use to focus errors. */
  name: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean;
  /** Renders the control with the ids and ARIA attributes that tie it to the label. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * A visible label, optional hint and error, wired to one control. Text fields,
 * selects and any future control share it, so labelling is done once.
 */
export function FormField({
  name,
  label,
  hint,
  error,
  required = false,
  children,
}: FormFieldProps) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? ' (required)' : ''}
      </label>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {children({
        id,
        required,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
