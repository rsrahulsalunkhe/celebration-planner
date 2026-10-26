import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { useCalendar, usePlannerDispatch } from '@/app/state/plannerContext.ts';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { buildLedger, startingBudgetOperations } from '@/domain/planning/budget.ts';
import type { EventRecord } from '@/domain/types.ts';
import { AllocationCard } from './AllocationCard.tsx';
import styles from './Budget.module.css';
import type { Commit, Report } from './budgetFormat.ts';
import { BudgetSummaryCard } from './BudgetSummaryCard.tsx';
import { ConflictsCard } from './ConflictsCard.tsx';
import { ExpensesCard } from './ExpensesCard.tsx';
import { WhatIfCard } from './WhatIfCard.tsx';

const CONFIG = PLANNING_CONFIGURATION;

export function BudgetPage() {
  return (
    <ActiveEventGate title="Budget">
      {(event) => <BudgetEditor key={event.profile.id} event={event} />}
    </ActiveEventGate>
  );
}

function BudgetEditor({ event }: { event: EventRecord }) {
  const dispatch = usePlannerDispatch();
  const calendar = useCalendar();
  const [message, setMessage] = useState<{ text: string; tone: StatusTone } | null>(null);

  const report: Report = (text, tone) => {
    setMessage({ text, tone });
  };
  const commit: Commit = (operations, success) => {
    if (operations.length === 0 || !applyOperations(event, operations)) {
      report('That change could not be saved. Check the values and try again.', 'error');
      return false;
    }
    dispatch({
      type: 'event/edit',
      eventId: event.profile.id,
      operations,
      expectedRevision: event.profile.revision,
    });
    report(success, 'success');
    return true;
  };

  const ledger = useMemo(() => buildLedger(event, CONFIG), [event]);
  const hasBudget = event.budgetCategories.length > 0;

  return (
    <>
      <PageHeader
        title="Budget"
        description={`For ${event.profile.title}. Targets, forecast costs, what is agreed and paid, and what is left.`}
      />
      <Stack>
        <StatusMessage message={message?.text} tone={message?.tone ?? 'info'} />
        <BudgetSummaryCard
          key={ledger.reserveBasisPoints}
          event={event}
          ledger={ledger}
          commit={commit}
        />
        {hasBudget ? (
          <>
            <ConflictsCard ledger={ledger} />
            <AllocationCard
              event={event}
              ledger={ledger}
              commit={commit}
              report={report}
            />
            <ExpensesCard event={event} ledger={ledger} commit={commit} report={report} />
            <WhatIfCard event={event} commit={commit} report={report} />
          </>
        ) : (
          <Card
            title="Start a budget"
            description="Categories, spending targets and starting estimates for this kind of event."
          >
            <p className={styles.note}>{CONFIG.ratesDisclosure}</p>
            <p className={styles.equation}>
              Estimates are marked “Illustrative rate” until you change them or enter an
              agreed amount. Targets are shared by planning weight after the reserve.
            </p>
            <div className={styles.section}>
              <Button
                icon={<Sparkles aria-hidden size={18} />}
                onClick={() => {
                  const ops = startingBudgetOperations(event, CONFIG, calendar.today());
                  if (ops.length === 0) {
                    report(
                      'This event has passed, so no starting budget is generated. Past events are kept as history.',
                      'info',
                    );
                    return;
                  }
                  commit(
                    ops,
                    'Created a starting budget from illustrative rates. Edit any estimate or target to make it yours.',
                  );
                }}
              >
                Create starting budget
              </Button>
            </div>
          </Card>
        )}
      </Stack>
    </>
  );
}
