import type { z } from 'zod';
import {
  CURRENT_SCHEMA_VERSION,
  eventRecordSchema,
  savedEnvelopeSchema,
} from '@/domain/schemas.ts';
import type { EventRecord } from '@/domain/types.ts';
import { EVENT_EXPORT_FORMAT, EVENT_EXPORT_VERSION } from './export.ts';

/**
 * Reads a plan file safely. Nothing here changes application state: the
 * result is a preview the user must confirm.
 *
 * - Files over 1 MB are refused before they are read.
 * - The text is parsed with `JSON.parse` in a try block; anything that is not
 *   a plain object, not one of the two known formats, or from another version
 *   is refused with a reason.
 * - Events are rebuilt through the Zod schemas, which construct new objects
 *   containing only the approved fields (unknown properties, including
 *   `__proto__`, are dropped) and check money as whole paise, real calendar
 *   dates, references and collection limits.
 */

export const MAX_IMPORT_BYTES = 1_000_000;

export type ImportResult =
  | {
      ok: true;
      kind: 'event' | 'backup';
      events: EventRecord[];
      exportedAt: string | null;
      /** Parts of the file that are deliberately not imported. */
      notImported: string[];
    }
  | { ok: false; title: string; details: string[] };

const fail = (title: string, details: string[] = []): ImportResult => ({
  ok: false,
  title,
  details,
});

export function checkImportSize(bytes: number): string | null {
  return bytes > MAX_IMPORT_BYTES
    ? `The file is ${(bytes / 1_000_000).toFixed(1)} MB. Plan files can be at most 1 MB.`
    : null;
}

function describeIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.slice(0, 6).map((issue) => {
    const where = issue.path.map(String).join(' › ');
    return where ? `${where}: ${issue.message}` : issue.message;
  });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export function parseImportText(text: string): ImportResult {
  const sizeProblem = checkImportSize(new Blob([text]).size);
  if (sizeProblem) return fail('This file is too large', [sizeProblem]);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('This file is not valid JSON', [
      'Choose a plan file exported from Celebration Planner.',
    ]);
  }
  if (!isPlainObject(raw)) {
    return fail('This is not a Celebration Planner file', [
      'The file does not contain a plan.',
    ]);
  }

  if ('format' in raw) {
    if (raw.format !== EVENT_EXPORT_FORMAT) {
      return fail('This is not a Celebration Planner plan file', [
        `Its format is “${String(raw.format).slice(0, 60)}”.`,
      ]);
    }
    if (raw.version !== EVENT_EXPORT_VERSION) {
      const version = typeof raw.version === 'number' ? raw.version : String(raw.version);
      return fail('This plan file’s version is not supported', [
        typeof raw.version === 'number' && raw.version > EVENT_EXPORT_VERSION
          ? `It was made by a newer version of Celebration Planner (format version ${version}). Open it there, or export it again from a version that matches this one.`
          : `Format version ${String(version).slice(0, 20)} is not one this version can read.`,
      ]);
    }
    const parsed = eventRecordSchema.safeParse(raw.event);
    if (!parsed.success) {
      return fail(
        'The plan in this file is not valid, so nothing was imported',
        describeIssues(parsed.error.issues),
      );
    }
    return {
      ok: true,
      kind: 'event',
      events: [parsed.data],
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : null,
      notImported:
        'conversation' in raw
          ? [
              'The assistant conversation saved in this file is not imported; conversations are never stored.',
            ]
          : [],
    };
  }

  if ('schemaVersion' in raw) {
    if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      return fail('This backup’s version is not supported', [
        `It uses saved-data version ${String(raw.schemaVersion).slice(0, 20)}; this version reads ${CURRENT_SCHEMA_VERSION}.`,
      ]);
    }
    const parsed = savedEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(
        'The backup in this file is not valid, so nothing was imported',
        describeIssues(parsed.error.issues),
      );
    }
    if (parsed.data.data.events.length === 0) {
      return fail('This backup has no events in it');
    }
    return {
      ok: true,
      kind: 'backup',
      events: parsed.data.data.events,
      exportedAt: null,
      notImported: [],
    };
  }

  return fail('This is not a Celebration Planner file', [
    'It has neither a plan format nor a saved-data version.',
  ]);
}
