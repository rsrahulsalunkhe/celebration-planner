import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { Card } from '@/components/Card.tsx';
import { ComingSoon } from '@/components/ComingSoon.tsx';
import { FactList } from '@/components/FactList.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';

export function VendorsPage() {
  return (
    <ActiveEventGate title="Vendors">
      {(event) => (
        <>
          <PageHeader
            title="Vendors"
            description={`For ${event.profile.title}. Track who you have contacted, quotes received and bookings.`}
          />
          <Stack>
            <Card title="Vendors so far">
              <FactList
                facts={[{ label: 'Vendors listed', value: String(event.vendors.length) }]}
              />
            </Card>
            <ComingSoon title="Vendor shortlist, quotes and bookings">
              <p>
                Adding vendors, recording quotes and agreed amounts, and tracking deposits
                and payments are not built yet. Vendor checklists exist in the planning
                rules but are not shown here.
              </p>
            </ComingSoon>
          </Stack>
        </>
      )}
    </ActiveEventGate>
  );
}
