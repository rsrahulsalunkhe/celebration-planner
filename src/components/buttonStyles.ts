import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

export interface ButtonAppearance {
  variant?: ButtonVariant | undefined;
  size?: 'normal' | 'small' | undefined;
}

/** Shared by `Button` and `ButtonLink` so links that look like buttons match. */
export function buttonClassName(
  { variant = 'primary', size = 'normal' }: ButtonAppearance,
  extra?: string,
): string {
  return [styles.button, styles[variant], size === 'small' ? styles.small : '', extra]
    .filter(Boolean)
    .join(' ');
}
