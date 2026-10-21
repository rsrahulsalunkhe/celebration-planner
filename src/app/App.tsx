import { HashRouter } from 'react-router-dom';
import { AppRoutes } from './AppRoutes.tsx';
import { PlannerProvider } from './state/PlannerProvider.tsx';

// HashRouter keeps routing client-side, so the static build works on any host
// without server rewrites.
export function App() {
  return (
    <HashRouter>
      <PlannerProvider>
        <AppRoutes />
      </PlannerProvider>
    </HashRouter>
  );
}
