import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { Card } from '@/components/Card.tsx';
import { ComingSoon } from '@/components/ComingSoon.tsx';
import { FactList } from '@/components/FactList.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Stack } from '@/components/Stack.tsx';
import { formatMoney } from '@/domain/money.ts';
import { DEFAULT_RESERVE_BASIS_POINTS } from '@/domain/primitives.ts';
import { selectBudgetSummary } from '@/domain/selectors.ts';

export function BudgetPage() {
  return (
    <ActiveEventGate title="Budget">
      {(event) => {
        const summary = selectBudgetSummary(event);
        const basisPoints =
          event.profile.reserveBasisPoints ?? DEFAULT_RESERVE_BASIS_POINTS;
        const source =
          event.profile.reserveBasisPoints === undefined ? 'the default' : 'your setting';
        return (
          <>
            <PageHeader
              title="Budget"
              description={`For ${event.profile.title}. See where the money goes and what changes when a constraint moves.`}
            />
            <Stack>
              <Card
                title="Budget at a glance"
                description={`Part of the budget is held back as a contingency reserve (${basisPoints / 100}%, ${source}).`}
              >
                <FactList
                  facts={[
                    { label: 'Total budget', value: formatMoney(summary.budgetPaise) },
                    {
                      label: 'Contingency reserve',
                      value: formatMoney(summary.reservePaise),
                    },
                    { label: 'Left to plan', value: formatMoney(summary.spendablePaise) },
                  ]}
                />
              </Card>
              <ComingSoon title="Category targets, cost forecasts and shortfall checks">
                <p>
                  The budget rules (target shares, forecasts, deposits, shortfalls and
                  ways to close a gap) are written and tested, but this screen does not
                  show them yet. Only the figures above come from your event.
                </p>
              </ComingSoon>
            </Stack>
          </>
        );
      }}
    </ActiveEventGate>
  );
}
