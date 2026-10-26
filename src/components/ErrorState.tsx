import { AlertTriangle } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import styles from './ErrorState.module.css';

interface ErrorStateProps {
  title: string;
  /** `warning` for something the user can work around, `error` for a failure. */
  tone?: 'error' | 'warning';
  children?: ReactNode;
  actions?: ReactNode;
  /** Level of the title in the page outline. 'none' for notices above the page heading. */
  headingLevel?: 1 | 2 | 3 | 'none';
}

/**
 * Something went wrong, what it means, and what to do. Announced to assistive
 * technology when it appears, so use it for real problems only.
 */
export function ErrorState({
  title,
  tone = 'error',
  children,
  actions,
  headingLevel = 2,
}: ErrorStateProps) {
  const titleId = useId();
  const Title = ({ none: 'p', 1: 'h1', 2: 'h2', 3: 'h3' } as const)[headingLevel];
  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      className={`${styles.panel} ${styles[tone]}`}
    >
      <div className={styles.heading}>
        <AlertTriangle aria-hidden size={20} className={styles.icon} />
        <Title id={titleId} className={styles.title}>
          {title}
        </Title>
      </div>
      {children ? <div className={styles.body}>{children}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
