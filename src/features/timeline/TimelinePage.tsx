import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';

export function TimelinePage() {
  return (
    <>
      <PageHeader
        title="Timeline"
        description="Tasks ordered by deadline, counted back from the event date."
      />
      <EmptyState title="The timeline is coming">
        A dated checklist that reflows when you move the event date is planned for a later
        stage.
      </EmptyState>
    </>
  );
}
