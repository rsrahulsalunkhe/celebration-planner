import { emptySavedState } from '@/domain/eventRecord.ts';
import type { SavedAppState } from '@/domain/types.ts';
import {
  clearAppStorage,
  loadSavedState,
  saveSavedState,
  type StorageLike,
} from './storage.ts';

/**
 * What the user needs to know about saving.
 * - `ready`: changes are being saved.
 * - `paused-*`: saved data exists but cannot be used. Saving is paused so it is
 *   never overwritten; the user must choose to recover or clear it.
 * - `unavailable`: storage could not be read at startup; work stays in memory.
 * - `save-failed`: storage worked at startup but a write failed; retryable.
 */
export type PersistenceStatus =
  | { kind: 'ready' }
  | { kind: 'paused-corrupt'; detail: string }
  | { kind: 'paused-too-new'; foundVersion: number }
  | { kind: 'unavailable' }
  | { kind: 'save-failed'; reason: 'quota' | 'too-large' | 'unavailable' };

export interface PersistenceSnapshot {
  status: PersistenceStatus;
  noticeDismissed: boolean;
}

/**
 * Owns the save lifecycle outside React so the rules are testable on their
 * own. Reads once at construction; never writes until it is safe to.
 */
export class PersistenceStore {
  readonly initialState: SavedAppState;
  private readonly storage: StorageLike | null;
  private snapshot: PersistenceSnapshot;
  private lastSaved: SavedAppState | null;
  private backupText: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(storage: StorageLike | null) {
    this.storage = storage;
    const loaded = loadSavedState(storage);
    let status: PersistenceStatus = { kind: 'ready' };
    let initialState = emptySavedState;

    switch (loaded.status) {
      case 'ok':
        initialState = loaded.state;
        break;
      case 'corrupt':
        status = { kind: 'paused-corrupt', detail: loaded.detail };
        this.backupText = loaded.raw;
        break;
      case 'too-new':
        status = { kind: 'paused-too-new', foundVersion: loaded.foundVersion };
        this.backupText = loaded.raw;
        break;
      case 'unavailable':
        status = { kind: 'unavailable' };
        break;
      case 'empty':
        break;
    }

    this.initialState = initialState;
    this.lastSaved = initialState;
    this.snapshot = { status, noticeDismissed: false };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PersistenceSnapshot => this.snapshot;

  /** The unreadable saved text, kept in memory so it can be downloaded. */
  getBackupText(): string | null {
    return this.backupText;
  }

  /** Saves `state` if it changed and saving is allowed. Safe to call repeatedly. */
  save(state: SavedAppState): void {
    if (state === this.lastSaved) return;
    const { kind } = this.snapshot.status;
    if (kind === 'paused-corrupt' || kind === 'paused-too-new' || kind === 'unavailable')
      return;

    const result = saveSavedState(this.storage, state);
    if (result.ok) {
      this.lastSaved = state;
      if (kind === 'save-failed')
        this.set({ status: { kind: 'ready' }, noticeDismissed: false });
      return;
    }
    const current = this.snapshot.status;
    if (current.kind === 'save-failed' && current.reason === result.reason) return;
    this.set({
      status: { kind: 'save-failed', reason: result.reason },
      noticeDismissed: false,
    });
  }

  /** Tries again after a failed write (for example after freeing space). */
  retry(state: SavedAppState): void {
    if (this.snapshot.status.kind !== 'save-failed') return;
    this.lastSaved = null;
    this.save(state);
  }

  /**
   * Removes this app's keys only. On success saving resumes from an empty
   * slate; the caller is expected to reset in-memory state to match.
   */
  clearSavedData(): boolean {
    const result = clearAppStorage(this.storage);
    if (!result.ok) return false;
    this.backupText = null;
    this.lastSaved = emptySavedState;
    this.set({ status: { kind: 'ready' }, noticeDismissed: false });
    return true;
  }

  dismissNotice(): void {
    if (this.snapshot.noticeDismissed) return;
    this.set({ ...this.snapshot, noticeDismissed: true });
  }

  private set(next: PersistenceSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => {
      listener();
    });
  }
}
