/** Random id for user-created records. Impure, so reducers never call it. */
export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Deterministic id for something generated from a template. Regenerating a
 * plan yields the same ids, so edits and links to generated items survive.
 */
export function generatedId(eventId: string, templateId: string): string {
  return `${eventId}~${templateId}`;
}
