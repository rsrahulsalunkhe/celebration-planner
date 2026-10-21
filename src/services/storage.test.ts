import { describe, expect, it } from 'vitest';
import { emptySavedState } from '@/domain/eventRecord.ts';
import { LIMITS } from '@/domain/primitives.ts';
import { MemoryStorage, makeEvent } from '@/test/helpers.ts';
import {
  SAVED_STATE_KEY,
  STORAGE_PREFIX,
  clearAppStorage,
  loadSavedState,
  saveSavedState,
  serializeSavedState,
} from './storage.ts';

const withEvent = { activeEventId: 'event-1', events: [makeEvent()] };

describe('loadSavedState', () => {
  it('reports empty when nothing is saved', () => {
    expect(loadSavedState(new MemoryStorage())).toEqual({ status: 'empty' });
  });

  it('round-trips saved state', () => {
    const storage = new MemoryStorage();
    expect(saveSavedState(storage, withEvent)).toEqual({ ok: true });
    expect(loadSavedState(storage)).toEqual({ status: 'ok', state: withEvent });
  });

  it('reports unavailable when storage is missing or reads throw', () => {
    expect(loadSavedState(null)).toEqual({ status: 'unavailable' });
    const blocked = new MemoryStorage();
    blocked.failReads = true;
    expect(loadSavedState(blocked)).toEqual({ status: 'unavailable' });
  });

  it('reports corrupt data and keeps the raw text for recovery', () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, '{not json');
    expect(loadSavedState(storage)).toMatchObject({
      status: 'corrupt',
      raw: '{not json',
    });
  });

  it('reports schema-invalid data with the first problem', () => {
    const storage = new MemoryStorage();
    const bad = {
      schemaVersion: 1,
      data: { activeEventId: null, events: [{ profile: { title: 'x' } }] },
    };
    storage.data.set(SAVED_STATE_KEY, JSON.stringify(bad));
    const result = loadSavedState(storage);
    expect(result.status).toBe('corrupt');
    expect(result.status === 'corrupt' && result.detail).toContain('events');
  });

  it('reports data from a newer version without trying to read it', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 2, data: { anything: true } });
    storage.data.set(SAVED_STATE_KEY, raw);
    expect(loadSavedState(storage)).toEqual({ status: 'too-new', raw, foundVersion: 2 });
  });

  it.each([
    ['0'],
    ['"text"'],
    ['null'],
    ['[]'],
    ['{"schemaVersion":"1"}'],
    ['{"schemaVersion":0.5}'],
  ])('treats %s as corrupt', (raw) => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, raw);
    expect(loadSavedState(storage).status).toBe('corrupt');
  });

  it('refuses oversized payloads before parsing them', () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, ' '.repeat(LIMITS.payloadChars + 1));
    expect(loadSavedState(storage)).toMatchObject({ status: 'corrupt' });
  });
});

describe('saveSavedState', () => {
  it('writes a versioned envelope that contains no chat', () => {
    const storage = new MemoryStorage();
    saveSavedState(storage, withEvent);
    const stored = JSON.parse(storage.data.get(SAVED_STATE_KEY) ?? '') as Record<
      string,
      unknown
    >;
    expect(Object.keys(stored).sort()).toEqual(['data', 'schemaVersion']);
    expect(stored.schemaVersion).toBe(1);
    expect(serializeSavedState(withEvent)).not.toMatch(/message|chat|assistant/i);
  });

  it('classifies quota and blocked writes and leaves old data intact', () => {
    const storage = new MemoryStorage();
    saveSavedState(storage, withEvent);
    const before = storage.data.get(SAVED_STATE_KEY);

    storage.failWrites = 'quota';
    expect(saveSavedState(storage, emptySavedState)).toEqual({
      ok: false,
      reason: 'quota',
    });
    storage.failWrites = 'blocked';
    expect(saveSavedState(storage, emptySavedState)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(saveSavedState(null, emptySavedState)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(storage.data.get(SAVED_STATE_KEY)).toBe(before);
  });

  it('never attempts a write over the size limit', () => {
    const storage = new MemoryStorage();
    const huge = makeEvent();
    huge.profile.title = 'x'.repeat(LIMITS.payloadChars);
    expect(saveSavedState(storage, { activeEventId: null, events: [huge] })).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(storage.setItemCalls).toBe(0);
  });
});

describe('clearAppStorage', () => {
  it('removes only keys with this app’s prefix', () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVED_STATE_KEY, 'a');
    storage.data.set(`${STORAGE_PREFIX}legacy`, 'b');
    storage.data.set('other-app:data', 'keep');
    storage.data.set('celebration-planner', 'keep: no trailing colon');
    expect(clearAppStorage(storage)).toEqual({ ok: true, removed: 2 });
    expect([...storage.data.keys()].sort()).toEqual([
      'celebration-planner',
      'other-app:data',
    ]);
  });

  it('reports failure without throwing', () => {
    expect(clearAppStorage(null).ok).toBe(false);
    const broken = new MemoryStorage();
    broken.data.set(SAVED_STATE_KEY, 'a');
    broken.removeItem = () => {
      throw new Error('blocked');
    };
    expect(clearAppStorage(broken).ok).toBe(false);
  });
});
