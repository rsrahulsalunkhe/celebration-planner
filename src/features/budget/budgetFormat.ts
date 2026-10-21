import { formatMoney } from '@/domain/money.ts';
import type { ConflictSeverity } from '@/domain/planning/types.ts';
import type { ChangeOperation, ExpenseItem } from '@/domain/types.ts';

/** Applies operations as one edit and announces the outcome. Returns whether it was applied. */
export type Commit = (operations: readonly ChangeOperation[], success: string) => boolean;

/** Announces something the user did that changed nothing (an error or a discard). */
export type Report = (text: string, tone: 'info' | 'success' | 'error') => void;

export const signedMoney = (paise: number): string =>
  `${paise > 0 ? '+' : paise < 0 ? '−' : ''}${formatMoney(Math.abs(paise))}`;

/** Negative amounts with a real minus sign, which reads correctly aloud. */
export const money = (paise: number): string =>
  paise < 0 ? `−${formatMoney(-paise)}` : formatMoney(paise);

export const pct = (basisPoints: number): string => `${(basisPoints / 100).toString()}%`;

export function costText(
  cost: ExpenseItem['estimate'] | NonNullable<ExpenseItem['commitment']>,
  guests: number,
): string {
  if (cost.basis === 'per-guest') {
    return `${formatMoney(cost.perGuestPaise)} per guest × ${guests} = ${formatMoney(cost.perGuestPaise * guests)}`;
  }
  return `Fixed ${formatMoney('totalPaise' in cost ? cost.totalPaise : cost.amountPaise)}`;
}

export const SEVERITY_LABELS: Record<ConflictSeverity, string> = {
  blocking: 'Blocked',
  critical: 'Needs attention',
  warning: 'Warning',
  info: 'Note',
};
