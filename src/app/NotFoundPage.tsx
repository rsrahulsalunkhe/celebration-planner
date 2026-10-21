import { Compass } from 'lucide-react';
import { ButtonLink } from '@/components/ButtonLink.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';

/** Shown for any address the app does not know, inside the normal shell. */
export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="There is nothing at this address"
        icon={<Compass aria-hidden size={28} />}
        actions={<ButtonLink to="/">Go to Overview</ButtonLink>}
      >
        The link may be old or mistyped. Use the menu to find what you need.
      </EmptyState>
    </>
  );
}
