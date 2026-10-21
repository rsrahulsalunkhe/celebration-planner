import styles from './StatusMessage.module.css';

export type StatusTone = 'info' | 'success' | 'error';

interface StatusMessageProps {
  /** `null` leaves the region empty. */
  message: string | null | undefined;
  tone?: StatusTone;
}

/**
 * A live region for the result of something the user just did.
 *
 * The region itself is always in the page and only its text changes, which is
 * what makes screen readers announce it. Errors are announced immediately;
 * everything else politely. Only render real outcomes here.
 */
export function StatusMessage({ message, tone = 'info' }: StatusMessageProps) {
  const isError = tone === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`${styles.message} ${styles[tone]}`}
    >
      {message}
    </div>
  );
}
