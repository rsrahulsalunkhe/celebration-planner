import { describe, expect, it, vi } from 'vitest';
import { emptySavedState } from '@/domain/eventRecord.ts';
import { MemoryStorage, makeEvent } from '@/test/helpers.ts';
import { PersistenceStore } from './persistence.ts';
import { SAVED_STATE_KEY, saveSavedState } from './storage.ts';

const state = { activeEventId: 'event-1', events: [makeEvent()] };

describe('PersistenceStore', () => {
  it('starts empty and does not write until something changes', () => {
    const storage = new MemoryStorage();
    const store = new PersistenceStore(storage);
    expect(store.initialState).toBe(emptySavedState);
    expect(store.getSnapshot().status).toEqual({ kind: 'ready' });
    store.save(store.initialState);
    expect(storage.setItemCalls).toBe(0);
    store.save(state);
    expect(storage.setItemCalls).toBe(1);
  });

  it('restores valid saved state', () => {
    const storage = new MemoryStorage();
    saveSavedState(storage, state);
    expect(new PersistenceStore(storage).initialState).toEqual(state);
  });

  it('does not rewrite an unchanged state object', () => {
    const storage = new MemoryStorage();
    const store = new PersistenceStore(storage);
    store.save(state);
    store.save(state);
    expect(storage.setItemCalls).toBe(1);
  });

  it.each([
    ['corrupt', '{broken', 'paused-corrupt'],
    ['too new', JSON.stringify({ schemaVersion: 9, data: {} }), 'paused-too-new'],
  ])('protects %s saved data from being overwritten', (_label, raw, kind) => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, raw);
    const store = new PersistenceStore(storage);

    expect(store.getSnapshot().status.kind).toBe(kind);
    expect(store.initialState).toBe(emptySavedState);
    expect(store.getBackupText()).toBe(raw);

    store.save(state); // the user keeps working in memory
    expect(storage.setItemCalls).toBe(0);
    expect(storage.data.get(SAVED_STATE_KEY)).toBe(raw);
  });

  it('clearing resumes saving from an empty slate and drops the backup', () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, '{broken');
    storage.data.set('other-app:x', 'keep');
    const store = new PersistenceStore(storage);

    expect(store.clearSavedData()).toBe(true);
    expect(store.getSnapshot().status).toEqual({ kind: 'ready' });
    expect(store.getBackupText()).toBeNull();
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(false);
    expect(storage.data.get('other-app:x')).toBe('keep');

    store.save(state);
    expect(storage.data.has(SAVED_STATE_KEY)).toBe(true);
  });

  it('stays in memory and never writes when storage is unavailable at startup', () => {
    const blocked = new MemoryStorage();
    blocked.failReads = true;
    for (const storage of [null, blocked]) {
      const store = new PersistenceStore(storage);
      expect(store.getSnapshot().status).toEqual({ kind: 'unavailable' });
      store.save(state);
    }
    expect(blocked.setItemCalls).toBe(0);
    expect(new PersistenceStore(null).clearSavedData()).toBe(false);
  });

  it('flags a failed write, keeps old data, and recovers on retry', () => {
    const storage = new MemoryStorage();
    const store = new PersistenceStore(storage);
    store.save(state);
    const saved = storage.data.get(SAVED_STATE_KEY);

    const next = { ...state, activeEventId: null };
    storage.failWrites = 'quota';
    store.save(next);
    expect(store.getSnapshot().status).toEqual({ kind: 'save-failed', reason: 'quota' });
    expect(storage.data.get(SAVED_STATE_KEY)).toBe(saved);

    storage.failWrites = 'none';
    store.retry(next);
    expect(store.getSnapshot().status).toEqual({ kind: 'ready' });
    expect(storage.data.get(SAVED_STATE_KEY)).not.toBe(saved);
  });

  it('notifies subscribers only when the snapshot changes', () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, '{broken');
    const store = new PersistenceStore(storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dismissNotice();
    store.dismissNotice();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().noticeDismissed).toBe(true);

    unsubscribe();
    store.clearSavedData();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
