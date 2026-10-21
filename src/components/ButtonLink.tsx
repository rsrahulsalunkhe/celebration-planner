import type { ComponentProps, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ButtonContent } from './Button.tsx';
import { buttonClassName, type ButtonAppearance } from './buttonStyles.ts';

type ButtonLinkProps = ComponentProps<typeof Link> &
  ButtonAppearance & {
    icon?: ReactNode;
  };

/** A real link (so it navigates and opens in a new tab) styled as a button. */
export function ButtonLink({
  variant,
  size,
  icon,
  children,
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size }, className)} {...rest}>
      <ButtonContent icon={icon}>{children}</ButtonContent>
    </Link>
  );
}
