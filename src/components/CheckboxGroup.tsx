import type { Option } from './options.ts';
import styles from './Fields.module.css';

interface CheckboxGroupProps<T extends string> {
  name: string;
  legend: string;
  options: readonly Option<T>[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
  hint?: string;
  error?: string | undefined;
}

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
          <label key={option.value} className={styles.option}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(e) => {
                onChange(
                  e.target.checked
                    ? [...selected, option.value]
                    : selected.filter((v) => v !== option.value),
                );
              }}
            />
            {option.label}
          </label>
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
