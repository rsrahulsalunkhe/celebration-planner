import type { ReactNode } from 'react';
import { Badge } from './Badge.tsx';
import { Card } from './Card.tsx';

/**
 * Marks part of the app that is not built yet. It says so plainly and never
 * shows controls, totals or results that do not exist.
 */
export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title} actions={<Badge tone="gold">Not built yet</Badge>}>
      {children}
    </Card>
  );
}
