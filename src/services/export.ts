import { selectActiveEvent } from '@/domain/selectors.ts';
import type { SavedAppState } from '@/domain/types.ts';
import { serializeSavedState } from './storage.ts';

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

function slugify(text: string): string {
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

/** Wraps unreadable saved text so the user can keep it before clearing. */
export function buildRecoveryFile(rawText: string): ExportFile {
  return {
    filename: 'celebration-planner-recovered-data.txt',
    mimeType: 'text/plain',
    content: rawText,
  };
}

/** Triggers a browser download. Everything stays on the user's device. */
export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
