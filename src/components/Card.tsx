import { useId, type ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  title: string;
  /** Heading level, so cards nest correctly under the page's h1. */
  headingLevel?: 2 | 3;
  /** Controls related to the whole card, shown beside the heading. */
  actions?: ReactNode;
  /** A short line under the heading. */
  description?: ReactNode;
  children?: ReactNode;
}

/** A titled group of related content. It is a labelled `section` landmark region. */
export function Card({
  title,
  headingLevel = 2,
  actions,
  description,
  children,
}: CardProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.head}>
        <div>
          <Heading id={headingId} className={styles.title}>
            {title}
          </Heading>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {children ? <div className={styles.body}>{children}</div> : null}
    </section>
  );
}
