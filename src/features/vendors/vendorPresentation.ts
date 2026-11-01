import { toOptions } from '@/components/options.ts';
import { VENDOR_KIND_LABELS } from '@/domain/planning/vendors.ts';

export const MAX_COMPARE = 3;
export const KIND_OPTIONS = toOptions(VENDOR_KIND_LABELS);
export const OUTCOME_WORDS = {
  met: 'Met',
  unknown: 'To confirm',
  failed: 'Not met',
} as const;
