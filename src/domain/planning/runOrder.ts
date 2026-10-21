import type { RunOrderItem } from '../types.ts';

/**
 * The event-day running order: items with explicit local start and end times
 * (`HH:MM`, 24-hour, no time zone). Order is always by time, so items are
 * reordered by changing their times in a form; nothing depends on dragging.
 */

export function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`Invalid time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export interface RunOrderRow {
  item: RunOrderItem;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  /** Other items whose time range overlaps this one. */
  overlapsWith: { id: string; title: string }[];
  /** Minutes free since the previous item ended; negative when they overlap. */
  gapBeforeMinutes: number | null;
}

export interface RunOrder {
  rows: RunOrderRow[];
  overlaps: { a: string; b: string; minutes: number; message: string }[];
  /** First start and last end, or `null` when empty. */
  span: { start: string; end: string } | null;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Sorts by start then end then title, and flags every overlapping pair. */
export function buildRunOrder(items: readonly RunOrderItem[]): RunOrder {
  const sorted = items
    .map((item) => ({
      item,
      startMinutes: minutesOf(item.start),
      endMinutes: minutesOf(item.end),
    }))
    .sort(
      (a, b) =>
        a.startMinutes - b.startMinutes ||
        a.endMinutes - b.endMinutes ||
        a.item.title.localeCompare(b.item.title),
    );

  const overlaps: RunOrder['overlaps'] = [];
  const withOverlap = new Map<string, { id: string; title: string }[]>();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (!a || !b || b.startMinutes >= a.endMinutes) continue;
      const minutes = Math.min(a.endMinutes, b.endMinutes) - b.startMinutes;
      overlaps.push({
        a: a.item.id,
        b: b.item.id,
        minutes,
        message: `“${a.item.title}” (${a.item.start}–${a.item.end}) and “${b.item.title}” (${b.item.start}–${b.item.end}) overlap by ${formatDuration(minutes)}.`,
      });
      withOverlap.set(a.item.id, [
        ...(withOverlap.get(a.item.id) ?? []),
        { id: b.item.id, title: b.item.title },
      ]);
      withOverlap.set(b.item.id, [
        ...(withOverlap.get(b.item.id) ?? []),
        { id: a.item.id, title: a.item.title },
      ]);
    }
  }

  let previousEnd: number | null = null;
  const rows = sorted.map((s): RunOrderRow => {
    const row: RunOrderRow = {
      ...s,
      durationMinutes: s.endMinutes - s.startMinutes,
      overlapsWith: withOverlap.get(s.item.id) ?? [],
      gapBeforeMinutes: previousEnd === null ? null : s.startMinutes - previousEnd,
    };
    previousEnd =
      previousEnd === null ? s.endMinutes : Math.max(previousEnd, s.endMinutes);
    return row;
  });

  const first = rows[0];
  const lastEnd = rows.reduce<RunOrderRow | null>(
    (latest, r) => (latest === null || r.endMinutes > latest.endMinutes ? r : latest),
    null,
  );
  return {
    rows,
    overlaps,
    span: first && lastEnd ? { start: first.item.start, end: lastEnd.item.end } : null,
  };
}
