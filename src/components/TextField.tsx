import type { HTMLInputTypeAttribute } from 'react';
import styles from './Fields.module.css';

interface TextFieldProps {
  /** Becomes the control's id (`field-<name>`), which forms use to focus errors. */
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
  type?: HTMLInputTypeAttribute;
  inputMode?: 'text' | 'numeric' | 'decimal';
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
}

export function TextField({
  name,
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  inputMode,
  multiline = false,
  required = false,
  maxLength,
}: TextFieldProps) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    className: styles.control,
    value,
    required,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  } as const;

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
      {multiline ? (
        <textarea
          {...common}
          rows={3}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      ) : (
        <input
          {...common}
          type={type}
          inputMode={inputMode}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      )}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
