import { Checkbox } from './Checkbox.tsx';
import styles from './Fields.module.css';
import type { Option } from './options.ts';

interface CheckboxGroupProps<T extends string> {
  name: string;
  legend: string;
  options: readonly Option<T>[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
  hint?: string;
  error?: string | undefined;
}

/** A fieldset of checkboxes with one legend, so a screen reader announces the group. */
export function CheckboxGroup<T extends string>({
  name,
  legend,
  options,
  selected,
  onChange,
  hint,
  error,
}: CheckboxGroupProps<T>) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset
      className={styles.group}
      id={id}
      aria-describedby={describedBy}
      tabIndex={-1}
    >
      <legend className={styles.legend}>{legend}</legend>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <div className={styles.options}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            onChange={(checked) => {
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((v) => v !== option.value),
              );
            }}
          />
        ))}
      </div>
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
