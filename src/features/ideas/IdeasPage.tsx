import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { Card } from '@/components/Card.tsx';
import { ComingSoon } from '@/components/ComingSoon.tsx';
import { FactList } from '@/components/FactList.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';

export function IdeasPage() {
  return (
    <ActiveEventGate title="Ideas">
      {(event) => (
        <>
          <PageHeader
            title="Ideas"
            description={`For ${event.profile.title}. Themes, activities and details to make the day feel personal.`}
          />
          <Stack>
            <Card title="Ideas so far">
              <FactList
                facts={[{ label: 'Ideas saved', value: String(event.ideas.length) }]}
              />
            </Card>
            <ComingSoon title="Suggestions matched to your event">
              <p>
                Idea suggestions tagged for your event type, with the reason each was
                chosen, are written in the planning rules but are not shown or saved from
                this screen yet.
              </p>
            </ComingSoon>
          </Stack>
        </>
      )}
    </ActiveEventGate>
  );
}
