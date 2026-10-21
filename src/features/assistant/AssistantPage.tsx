import { EmptyState } from '@/components/EmptyState.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { noModelAdapter } from '@/services/ai/adapter.ts';

export function AssistantPage() {
  const adapter = noModelAdapter;
  return (
    <>
      <PageHeader
        title="Assistant"
        description="Optional help that runs on your device. Planning works without it."
      />
      <EmptyState title="No local model enabled">
        Status: {adapter.label} ({adapter.availability()}). A later stage adds an optional
        on-device model that runs in a Web Worker. Nothing is sent to a server.
      </EmptyState>
    </>
  );
}
