import { eventRecordSchema } from './schemas.ts';
import type {
  ChangeOperation,
  CollectionItems,
  CollectionName,
  EventProfile,
  EventRecord,
} from './types.ts';

function upsert<K extends CollectionName>(
  record: EventRecord,
  key: K,
  item: CollectionItems[K],
): EventRecord {
  const list = record[key] as CollectionItems[K][];
  const exists = list.some((existing) => existing.id === item.id);
  const next = exists
    ? list.map((existing) => (existing.id === item.id ? item : existing))
    : [...list, item];
  return { ...record, [key]: next };
}

/** Removes an item and keeps references consistent instead of leaving them dangling. */
function remove(record: EventRecord, key: CollectionName, itemId: string): EventRecord {
  const list = record[key] as { id: string }[];
  const next: EventRecord = {
    ...record,
    [key]: list.filter((item) => item.id !== itemId),
  };
  if (key === 'budgetCategories') {
    // Expenses cannot exist without a category.
    return { ...next, expenses: next.expenses.filter((e) => e.categoryId !== itemId) };
  }
  if (key === 'vendors') {
    return {
      ...next,
      expenses: next.expenses.map(({ vendorId, ...rest }) =>
        vendorId === itemId ? rest : { ...rest, ...(vendorId ? { vendorId } : {}) },
      ),
      tasks: next.tasks.map(({ vendorId, ...rest }) =>
        vendorId === itemId ? rest : { ...rest, ...(vendorId ? { vendorId } : {}) },
      ),
    };
  }
  if (key === 'tasks') {
    // Other tasks stop depending on the removed one.
    return {
      ...next,
      tasks: next.tasks.map((task) => {
        if (!task.dependsOn?.includes(itemId)) return task;
        const dependsOn = task.dependsOn.filter((dep) => dep !== itemId);
        const { dependsOn: _old, ...rest } = task;
        return dependsOn.length > 0 ? { ...rest, dependsOn } : rest;
      }),
    };
  }
  return next;
}

function patchProfile(
  profile: EventProfile,
  patch: Extract<ChangeOperation, { op: 'profile/patch' }>['patch'],
): EventProfile {
  const { ageBand, ...rest } = patch;
  const { ageBand: _previousAgeBand, ...base } = profile;
  const next: EventProfile = { ...base, ...rest };
  const resolved = ageBand === undefined ? profile.ageBand : (ageBand ?? undefined);
  return resolved ? { ...next, ageBand: resolved } : next;
}

function applyOperation(record: EventRecord, op: ChangeOperation): EventRecord {
  switch (op.op) {
    case 'profile/patch':
      return { ...record, profile: patchProfile(record.profile, op.patch) };
    case 'preferences/set':
      return { ...record, preferences: op.preferences };
    case 'budgetCategories/upsert':
      return upsert(record, 'budgetCategories', op.item);
    case 'budgetCategories/remove':
      return remove(record, 'budgetCategories', op.itemId);
    case 'expenses/upsert':
      return upsert(record, 'expenses', op.item);
    case 'expenses/remove':
      return remove(record, 'expenses', op.itemId);
    case 'tasks/upsert':
      return upsert(record, 'tasks', op.item);
    case 'tasks/remove':
      return remove(record, 'tasks', op.itemId);
    case 'vendors/upsert':
      return upsert(record, 'vendors', op.item);
    case 'vendors/remove':
      return remove(record, 'vendors', op.itemId);
    case 'guests/upsert':
      return upsert(record, 'guests', op.item);
    case 'guests/remove':
      return remove(record, 'guests', op.itemId);
    case 'ideas/upsert':
      return upsert(record, 'ideas', op.item);
    case 'ideas/remove':
      return remove(record, 'ideas', op.itemId);
    case 'runOrder/upsert':
      return upsert(record, 'runOrder', op.item);
    case 'runOrder/remove':
      return remove(record, 'runOrder', op.itemId);
  }
}

export type ApplyResult =
  { ok: true; record: EventRecord } | { ok: false; issues: string[] };

/**
 * Applies operations as one edit: the revision rises by exactly one and the
 * whole record is re-validated. Nothing is applied if the result would
 * violate any schema rule, limit or reference; the issues say why.
 */
export function tryApplyOperations(
  record: EventRecord,
  operations: readonly ChangeOperation[],
): ApplyResult {
  let next = record;
  for (const op of operations) next = applyOperation(next, op);
  next = { ...next, profile: { ...next.profile, revision: record.profile.revision + 1 } };
  const parsed = eventRecordSchema.safeParse(next);
  if (parsed.success) return { ok: true, record: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.slice(0, 5).map((issue) => {
      const where = issue.path.map(String).join('.');
      return where ? `${where}: ${issue.message}` : issue.message;
    }),
  };
}

/** As `tryApplyOperations`, returning `null` when the edit is not valid. */
export function applyOperations(
  record: EventRecord,
  operations: readonly ChangeOperation[],
): EventRecord | null {
  const result = tryApplyOperations(record, operations);
  return result.ok ? result.record : null;
}
