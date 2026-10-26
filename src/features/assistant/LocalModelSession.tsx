import { useContext, useEffect, useState, type ReactNode } from 'react';
import { LocalModelController } from '@/services/ai/local/localModel.ts';
import { LocalModelContext } from './localModelContext.ts';

/**
 * Holds the local model for the whole session, so moving between pages does
 * not reload it. The worker is ended when the app is closed or this unmounts.
 * Creating the controller loads nothing. A controller provided further up
 * (by tests, with fake dependencies) is used instead of a new one.
 */
export function LocalModelSession({ children }: { children: ReactNode }) {
  const outer = useContext(LocalModelContext);
  const [own] = useState(() => (outer ? null : new LocalModelController()));
  useEffect(() => {
    if (!own) return;
    const end = () => {
      own.dispose();
    };
    window.addEventListener('pagehide', end);
    return () => {
      window.removeEventListener('pagehide', end);
      own.dispose();
    };
  }, [own]);
  if (!own) return <>{children}</>;
  return <LocalModelContext value={own}>{children}</LocalModelContext>;
}
