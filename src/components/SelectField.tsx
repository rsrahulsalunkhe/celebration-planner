import type { Option } from './options.ts';
import styles from './Fields.module.css';

interface SelectFieldProps<T extends string> {
  name: string;
  label: string;
  value: T | '';
  options: readonly Option<T>[];
  onChange: (value: T | '') => void;
  /** When set, adds an empty first option with this text. */
  placeholder?: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
}

export function SelectField<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
  hint,
  required = false,
}: SelectFieldProps<T>) {
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
      <select
        id={id}
        className={styles.control}
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          onChange(e.target.value as T | '');
        }}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
