import { Navigate, Route, Routes } from 'react-router-dom';
import { AssistantPage } from '@/features/assistant/AssistantPage.tsx';
import { BudgetPage } from '@/features/budget/BudgetPage.tsx';
import { EventsPage } from '@/features/events/EventsPage.tsx';
import { IdeasPage } from '@/features/ideas/IdeasPage.tsx';
import { TimelinePage } from '@/features/timeline/TimelinePage.tsx';
import { VendorsPage } from '@/features/vendors/VendorsPage.tsx';
import { AppShell } from './AppShell.tsx';
import { NotFoundPage } from './NotFoundPage.tsx';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/events" replace />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="vendors" element={<VendorsPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="ideas" element={<IdeasPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
