import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';

export function IdeasPage() {
  return (
    <>
      <PageHeader
        title="Ideas"
        description="Themes, activities and details to make the day feel personal."
      />
      <EmptyState title="Ideas are coming">
        Curated suggestions matched to your event type and budget are planned for a later
        stage.
      </EmptyState>
    </>
  );
}
