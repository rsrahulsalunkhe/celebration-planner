import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';

export function BudgetPage() {
  return (
    <>
      <PageHeader
        title="Budget"
        description="See where the money goes and what changes when a constraint moves."
      />
      <EmptyState title="Budget planning is coming">
        A category-by-category budget with explained allocations is planned for a later
        stage.
      </EmptyState>
    </>
  );
}
