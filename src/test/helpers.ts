import { addDays, type CalendarHelper } from '@/domain/dates.ts';
import { DEMO_PRESETS, buildDemoEvent } from '@/data/presets.ts';
import { createEventRecord } from '@/domain/eventRecord.ts';
import type {
  BudgetCategory,
  EventRecord,
  ExpenseItem,
  PlanningTask,
  Vendor,
} from '@/domain/types.ts';
import type { StorageLike } from '@/services/storage.ts';

export const TODAY = '2026-10-21';

/** A calendar pinned to a fixed day, so date-derived values never drift. */
export function fixedCalendar(today: string = TODAY): CalendarHelper {
  return { today: () => today, addDays };
}

/** In-memory Storage that can be told to fail, for testing recovery paths. */
export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  failReads = false;
  failWrites: 'none' | 'quota' | 'blocked' = 'none';
  setItemCalls = 0;

  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    if (this.failReads) throw new DOMException('Access denied', 'SecurityError');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.setItemCalls += 1;
    if (this.failWrites === 'quota') throw new DOMException('Full', 'QuotaExceededError');
    if (this.failWrites === 'blocked') throw new DOMException('Denied', 'SecurityError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export function makeEvent(
  id = 'event-1',
  overrides: Partial<EventRecord['profile']> = {},
): EventRecord {
  return createEventRecord({
    id,
    title: 'Test event',
    eventType: 'community',
    date: '2027-01-15',
    city: 'Pune',
    guestCount: 50,
    budgetPaise: 1_000_000,
    setting: 'outdoor',
    ...overrides,
  });
}

export const category = (id: string, plannedPaise: number): BudgetCategory => ({
  id,
  name: `Category ${id}`,
  plannedPaise,
  plannedOrigin: 'user',
});

export const expense = (
  id: string,
  categoryId: string,
  amountPaise: number,
  extra: Partial<ExpenseItem> = {},
): ExpenseItem => ({
  id,
  categoryId,
  name: `Expense ${id}`,
  estimate: { basis: 'fixed', amountPaise },
  estimateOrigin: 'user',
  commitment: null,
  payments: [],
  ...extra,
});

export const task = (id: string, extra: Partial<PlanningTask> = {}): PlanningTask => ({
  id,
  title: `Task ${id}`,
  dueDate: '2026-12-01',
  dueDateOrigin: 'user',
  status: 'todo',
  ...extra,
});

export const vendor = (id: string): Vendor => ({
  id,
  name: `Vendor ${id}`,
  kind: 'catering',
  status: 'shortlisted',
  quotePaise: null,
});

/** A demo preset as an event record, with dates pinned to `today`. */
export function presetEvent(
  id: 'wedding' | 'birthday' | 'community',
  today: string = TODAY,
): EventRecord {
  const preset = DEMO_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset ${id}`);
  return buildDemoEvent(preset, {
    eventId: `event-${id}`,
    calendar: fixedCalendar(today),
  });
}

/** A copy of a record with some profile fields changed. */
export function withProfile(
  record: EventRecord,
  changes: Partial<EventRecord['profile']>,
): EventRecord {
  return { ...record, profile: { ...record.profile, ...changes } };
}
