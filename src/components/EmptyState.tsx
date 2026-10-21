import { useId, type ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}

/** Nothing here yet, and what to do next. Not an error. */
export function EmptyState({ title, icon, children, actions }: EmptyStateProps) {
  const titleId = useId();
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {children ? <div className={styles.body}>{children}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
