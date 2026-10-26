import { Navigate, Route, Routes } from 'react-router-dom';
import { AssistantPage } from '@/features/assistant/AssistantPage.tsx';
import { AssistantSessionProvider } from '@/features/assistant/AssistantSessionProvider.tsx';
import { LocalModelSession } from '@/features/assistant/LocalModelSession.tsx';
import { BudgetPage } from '@/features/budget/BudgetPage.tsx';
import { DataPage } from '@/features/data/DataPage.tsx';
import { NewEventPage } from '@/features/events/NewEventPage.tsx';
import { IdeasPage } from '@/features/ideas/IdeasPage.tsx';
import { OverviewPage } from '@/features/overview/OverviewPage.tsx';
import { TimelinePage } from '@/features/timeline/TimelinePage.tsx';
import { VendorsPage } from '@/features/vendors/VendorsPage.tsx';
import { AppShell } from './AppShell.tsx';
import { NotFoundPage } from './NotFoundPage.tsx';

export function AppRoutes() {
  // Assistant conversations outlive page changes but are never saved.
  return (
    <LocalModelSession>
      <AssistantSessionProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="new" element={<NewEventPage />} />
            <Route path="budget" element={<BudgetPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="ideas" element={<IdeasPage />} />
            <Route path="data" element={<DataPage />} />
            {/* The stage 1 address for the events page. */}
            <Route path="events" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AssistantSessionProvider>
    </LocalModelSession>
  );
}
