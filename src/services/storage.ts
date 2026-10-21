import { LIMITS } from '@/domain/primitives.ts';
import { CURRENT_SCHEMA_VERSION, savedEnvelopeSchema } from '@/domain/schemas.ts';
import type { SavedAppState, SavedEnvelope } from '@/domain/types.ts';

/** Every key this app writes starts with this prefix; nothing else is ever touched. */
export const STORAGE_PREFIX = 'celebration-planner:';
export const SAVED_STATE_KEY = `${STORAGE_PREFIX}saved-state`;

export type StorageLike = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

/** `window.localStorage` itself can throw (blocked cookies, sandboxed frames). */
export function getBrowserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; state: SavedAppState }
  /** Present but unreadable. `raw` is kept so the user can recover it. */
  | { status: 'corrupt'; raw: string; detail: string }
  | { status: 'too-new'; raw: string; foundVersion: number }
  | { status: 'unavailable' };

function describeIssue(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): string {
  const issue = error.issues[0];
  if (!issue) return 'The saved data does not match the expected format.';
  const where = issue.path.map(String).join('.');
  return `${where ? `${where}: ` : ''}${issue.message}`;
}

export function loadSavedState(storage: StorageLike | null): LoadResult {
  if (!storage) return { status: 'unavailable' };

  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_STATE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null) return { status: 'empty' };

  if (raw.length > LIMITS.payloadChars) {
    return {
      status: 'corrupt',
      raw,
      detail: 'The saved data is larger than the supported limit.',
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', raw, detail: 'The saved data is not valid JSON.' };
  }

  if (typeof json === 'object' && json !== null && 'schemaVersion' in json) {
    const version = json.schemaVersion;
    if (
      typeof version === 'number' &&
      Number.isInteger(version) &&
      version > CURRENT_SCHEMA_VERSION
    ) {
      return { status: 'too-new', raw, foundVersion: version };
    }
  }

  const parsed = savedEnvelopeSchema.safeParse(json);
  return parsed.success
    ? { status: 'ok', state: parsed.data.data }
    : { status: 'corrupt', raw, detail: describeIssue(parsed.error) };
}

export function serializeSavedState(state: SavedAppState): string {
  const envelope: SavedEnvelope = { schemaVersion: CURRENT_SCHEMA_VERSION, data: state };
  return JSON.stringify(envelope);
}

export type SaveResult =
  { ok: true } | { ok: false; reason: 'too-large' | 'quota' | 'unavailable' };

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

/**
 * Writes the state. On any failure the previously saved value is left as it
 * was: oversized payloads are never attempted, and `setItem` does not
 * partially write.
 */
export function saveSavedState(
  storage: StorageLike | null,
  state: SavedAppState,
): SaveResult {
  if (!storage) return { ok: false, reason: 'unavailable' };
  const payload = serializeSavedState(state);
  if (payload.length > LIMITS.payloadChars) return { ok: false, reason: 'too-large' };
  try {
    storage.setItem(SAVED_STATE_KEY, payload);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? 'quota' : 'unavailable' };
  }
}

/** Removes only keys that start with this app's prefix. */
export function clearAppStorage(storage: StorageLike | null): {
  ok: boolean;
  removed: number;
} {
  if (!storage) return { ok: false, removed: 0 };
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => {
      storage.removeItem(key);
    });
    return { ok: true, removed: keys.length };
  } catch {
    return { ok: false, removed: 0 };
  }
}
