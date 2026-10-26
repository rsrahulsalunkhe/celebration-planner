import { selectActiveEvent } from '@/domain/selectors.ts';
import type { EventRecord, SavedAppState } from '@/domain/types.ts';
import { serializeSavedState } from './storage.ts';

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

/** Identifies a one-event plan file. Bump the version when its shape changes. */
export const EVENT_EXPORT_FORMAT = 'celebration-planner/event';
export const EVENT_EXPORT_VERSION = 1;

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'celebration-planner';
}

/**
 * JSON export of all saved events, in the same versioned envelope that is
 * stored in the browser. Chat is never part of it. Pure, so it is testable.
 */
export function buildJsonExport(state: SavedAppState): ExportFile {
  const active = selectActiveEvent(state);
  const name = active ? active.profile.title : 'celebration-planner';
  return {
    filename: `${slugify(name)}.json`,
    mimeType: 'application/json',
    content: JSON.stringify(JSON.parse(serializeSavedState(state)), null, 2),
  };
}

export interface TranscriptLine {
  role: 'user' | 'assistant';
  text: string;
}

export interface EventExportOptions {
  /** ISO timestamp of the export, supplied by the caller. */
  exportedAt: string;
  /** Leave out guest names, sizes and notes. */
  includeGuests: boolean;
  /** This session's assistant conversation, only when the user asks for it. */
  conversation?: readonly TranscriptLine[];
}

/**
 * One event as a versioned plan file: profile, preferences, budget records
 * (categories, expenses, payments), tasks, vendors, ideas and the running
 * order. Assistant runtime state is never included; the conversation only
 * when explicitly requested, and it is not read back on import.
 */
export function buildEventExport(
  record: EventRecord,
  options: EventExportOptions,
): ExportFile {
  const event: EventRecord = options.includeGuests ? record : { ...record, guests: [] };
  const file = {
    format: EVENT_EXPORT_FORMAT,
    version: EVENT_EXPORT_VERSION,
    exportedAt: options.exportedAt,
    guestsIncluded: options.includeGuests,
    event,
    ...(options.conversation && options.conversation.length > 0
      ? {
          conversation: options.conversation.map((l) => ({ role: l.role, text: l.text })),
        }
      : {}),
  };
  return {
    filename: `${slugify(record.profile.title)}-plan.json`,
    mimeType: 'application/json',
    content: JSON.stringify(file, null, 2),
  };
}

/** Wraps unreadable saved text so the user can keep it before clearing. */
export function buildRecoveryFile(rawText: string): ExportFile {
  return {
    filename: 'celebration-planner-recovered-data.txt',
    mimeType: 'text/plain',
    content: rawText,
  };
}

/**
 * Triggers a browser download from a Blob. Everything stays on the user's
 * device. The object URL is released shortly after the click, once the
 * browser has started the download. Returns false if the browser refused.
 */
export function downloadFile(file: ExportFile): boolean {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  } finally {
    if (url !== null) {
      const created = url;
      setTimeout(() => {
        URL.revokeObjectURL(created);
      }, 1_000);
    }
  }
}
