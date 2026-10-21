import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Small labels beside the description, such as "Demo". */
  badges?: ReactNode;
  actions?: ReactNode;
}

/** The page's one `h1`. It can take focus, so navigation can move the reader here. */
export function PageHeader({ title, description, badges, actions }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title} tabIndex={-1}>
          {title}
        </h1>
        {description || badges ? (
          <div className={styles.meta}>
            {badges}
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
        ) : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
