import { Card } from '@/components/Card.tsx';
import { ComingSoon } from '@/components/ComingSoon.tsx';
import { FactList } from '@/components/FactList.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import { noModelAdapter } from '@/services/ai/adapter.ts';

const AVAILABILITY = {
  unavailable: 'Not available',
  loading: 'Loading',
  ready: 'Ready',
} as const;

export function AssistantPage() {
  const adapter = noModelAdapter;
  return (
    <>
      <PageHeader
        title="Assistant"
        description="Optional help that runs on your device. Planning works without it."
      />
      <Stack>
        <Card title="Local model">
          <FactList
            facts={[
              { label: 'Model', value: adapter.label },
              { label: 'Status', value: AVAILABILITY[adapter.availability()] },
            ]}
          />
        </Card>
        <ComingSoon title="Chat and suggested changes">
          <p>
            The optional on-device assistant is not built yet, so there is nothing to type
            into and no chat. Nothing is sent to a server, and chat will not be saved when
            it arrives.
          </p>
        </ComingSoon>
      </Stack>
    </>
  );
}
