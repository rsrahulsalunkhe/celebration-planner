import type { HTMLInputTypeAttribute } from 'react';
import styles from './Fields.module.css';
import { FormField } from './FormField.tsx';

interface TextFieldProps {
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
  autoComplete?: string;
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
  autoComplete,
}: TextFieldProps) {
  return (
    <FormField name={name} label={label} hint={hint} error={error} required={required}>
      {(control) =>
        multiline ? (
          <textarea
            {...control}
            className={styles.control}
            value={value}
            rows={3}
            maxLength={maxLength}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
        ) : (
          <input
            {...control}
            className={styles.control}
            type={type}
            inputMode={inputMode}
            value={value}
            maxLength={maxLength}
            autoComplete={autoComplete}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
        )
      }
    </FormField>
  );
}
