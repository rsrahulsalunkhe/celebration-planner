import type { ReactNode } from 'react';

/** Text for assistive technology that is not drawn on screen. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="srOnly">{children}</span>;
}
