import { generatedId } from './ids.ts';
import { eventRecordSchema } from './schemas.ts';
import type { EventRecord } from './types.ts';

/**
 * Makes an imported event a separate copy: a new event id and new ids for
 * everything in it, with every reference remapped (expense to category and
 * vendor, task to vendor and dependencies, idea to its task, a vendor's
 * deposit payment). Items generated from templates keep template-derived
 * ids under the new event id, so later plan updates still recognise them.
 */
export function copyWithNewIds(
  record: EventRecord,
  newEventId: string,
  makeId: (prefix: string) => string,
): EventRecord | null {
  const remap = <T extends { id: string; templateId?: string | undefined }>(
    items: readonly T[],
    prefix: string,
  ): Map<string, string> =>
    new Map(
      items.map((item) => [
        item.id,
        item.templateId !== undefined
          ? generatedId(newEventId, item.templateId)
          : makeId(prefix),
      ]),
    );

  const categories = remap(record.budgetCategories, 'category');
  const vendors = remap(record.vendors, 'vendor');
  const ideas = remap(record.ideas, 'idea');
  const guests = remap(record.guests, 'guest');
  const runOrder = remap(record.runOrder, 'run');
  // A task made from an idea keeps the "<idea id>~task" link.
  const ideaForTask = new Map(
    record.ideas.flatMap((i) => (i.taskId ? [[i.taskId, i.id] as const] : [])),
  );
  const tasks = new Map(
    record.tasks.map((t) => {
      const fromIdea = ideaForTask.get(t.id);
      const newIdea = fromIdea ? ideas.get(fromIdea) : undefined;
      return [
        t.id,
        t.templateId !== undefined
          ? generatedId(newEventId, t.templateId)
          : newIdea
            ? `${newIdea}~task`
            : makeId('task'),
      ];
    }),
  );
  const expenses = remap(record.expenses, 'expense');
  const must = (map: Map<string, string>, id: string): string => {
    const next = map.get(id);
    if (next === undefined) throw new Error(`Unmapped id ${id}`);
    return next;
  };

  let copy: EventRecord;
  try {
    copy = {
      profile: { ...record.profile, id: newEventId, revision: 0 },
      preferences: record.preferences,
      budgetCategories: record.budgetCategories.map((c) => ({
        ...c,
        id: must(categories, c.id),
      })),
      expenses: record.expenses.map((e) => {
        const vendorId = e.vendorId === undefined ? undefined : must(vendors, e.vendorId);
        return {
          ...e,
          id: must(expenses, e.id),
          categoryId: must(categories, e.categoryId),
          ...(vendorId === undefined ? {} : { vendorId }),
          payments: e.payments.map((p) => ({
            ...p,
            id:
              e.vendorId !== undefined && p.id === `${e.vendorId}~deposit` && vendorId
                ? `${vendorId}~deposit`
                : makeId('payment'),
          })),
        };
      }),
      tasks: record.tasks.map((t) => {
        const { vendorId, dependsOn, ...rest } = t;
        return {
          ...rest,
          id: must(tasks, t.id),
          ...(vendorId === undefined ? {} : { vendorId: must(vendors, vendorId) }),
          ...(dependsOn === undefined
            ? {}
            : { dependsOn: dependsOn.map((d) => must(tasks, d)) }),
        };
      }),
      vendors: record.vendors.map((v) => ({ ...v, id: must(vendors, v.id) })),
      guests: record.guests.map((g) => ({ ...g, id: must(guests, g.id) })),
      ideas: record.ideas.map((i) => {
        const { taskId, ...rest } = i;
        const linked = taskId === undefined ? undefined : tasks.get(taskId);
        return {
          ...rest,
          id: must(ideas, i.id),
          ...(linked === undefined ? {} : { taskId: linked }),
        };
      }),
      runOrder: record.runOrder.map((r) => ({ ...r, id: must(runOrder, r.id) })),
    };
  } catch {
    return null;
  }
  // The schema's integrity check confirms every reference resolves inside the copy.
  const parsed = eventRecordSchema.safeParse(copy);
  return parsed.success ? parsed.data : null;
}
