import type { PersistedPlanner, PlannerState } from '@/domain/types.ts';

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
  return slug || 'plan';
}

/** Builds the JSON export. Pure, so it can be tested without a browser. */
export function buildJsonExport(state: PlannerState): ExportFile {
  const envelope: PersistedPlanner = { version: 1, state };
  return {
    filename: `${slugify(state.event?.name ?? 'celebration-plan')}.json`,
    mimeType: 'application/json',
    content: JSON.stringify(envelope, null, 2),
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
