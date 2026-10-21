import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState title="That page does not exist">
        <Link to="/events">Back to your event</Link>
      </EmptyState>
    </>
  );
}
