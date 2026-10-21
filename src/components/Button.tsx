import type { ComponentProps, ReactNode } from 'react';
import { VisuallyHidden } from './VisuallyHidden.tsx';
import { buttonClassName, type ButtonAppearance } from './buttonStyles.ts';

interface ContentProps {
  icon?: ReactNode;
  /** Shows only the icon. The text stays in the page for assistive technology. */
  hideLabel?: boolean | undefined;
}

export function ButtonContent({
  icon,
  hideLabel,
  children,
}: ContentProps & { children: ReactNode }) {
  return (
    <>
      {icon}
      {hideLabel ? <VisuallyHidden>{children}</VisuallyHidden> : children}
    </>
  );
}

type ButtonProps = ComponentProps<'button'> & ButtonAppearance & ContentProps;

export function Button({
  variant,
  size,
  icon,
  hideLabel,
  children,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size }, className)}
      {...rest}
    >
      <ButtonContent icon={icon} hideLabel={hideLabel}>
        {children}
      </ButtonContent>
    </button>
  );
}
