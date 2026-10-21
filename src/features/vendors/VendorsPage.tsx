import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';

export function VendorsPage() {
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Track who you have contacted, quotes received and bookings."
      />
      <EmptyState title="Vendor tracking is coming">
        A shortlist with quotes and booking status is planned for a later stage.
      </EmptyState>
    </>
  );
}
