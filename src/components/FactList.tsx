import type { ReactNode } from 'react';
import styles from './FactList.module.css';

export interface Fact {
  label: string;
  value: ReactNode;
}

/** Labelled values as a description list, so each label is tied to its value. */
export function FactList({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className={styles.list}>
      {facts.map((fact) => (
        <div key={fact.label} className={styles.item}>
          <dt className={styles.label}>{fact.label}</dt>
          <dd className={styles.value}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
