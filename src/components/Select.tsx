import styles from './Fields.module.css';
import { FormField } from './FormField.tsx';
import type { Option } from './options.ts';

interface SelectProps<T extends string> {
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

/** A native select: keyboard, screen reader and mobile behaviour come from the browser. */
export function Select<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
  hint,
  required = false,
}: SelectProps<T>) {
  return (
    <FormField name={name} label={label} hint={hint} error={error} required={required}>
      {(control) => (
        <select
          {...control}
          className={styles.control}
          value={value}
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
      )}
    </FormField>
  );
}
