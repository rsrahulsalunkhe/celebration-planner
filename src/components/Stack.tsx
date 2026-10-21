import type { ReactNode } from 'react';
import styles from './Stack.module.css';

/** Vertical spacing between sibling blocks, so pages do not hand-roll margins. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
