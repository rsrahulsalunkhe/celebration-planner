import { describe, expect, it } from 'vitest';
import { emptySavedState } from '@/domain/eventRecord.ts';
import { savedEnvelopeSchema } from '@/domain/schemas.ts';
import { makeEvent } from '@/test/helpers.ts';
import { buildJsonExport, buildRecoveryFile } from './export.ts';

describe('buildJsonExport', () => {
  it('produces a valid versioned envelope named after the active event', () => {
    const state = {
      activeEventId: 'event-1',
      events: [makeEvent('event-1', { title: 'Meera & Arjun’s Wedding' })],
    };
    const file = buildJsonExport(state);
    expect(file.filename).toBe('meera-arjun-s-wedding.json');
    expect(file.mimeType).toBe('application/json');
    const parsed = savedEnvelopeSchema.safeParse(JSON.parse(file.content));
    expect(parsed.success && parsed.data.data).toEqual(state);
  });

  it('falls back to a generic name without an active event', () => {
    expect(buildJsonExport(emptySavedState).filename).toBe('celebration-planner.json');
  });
});

describe('buildRecoveryFile', () => {
  it('returns the unreadable text unchanged', () => {
    expect(buildRecoveryFile('{broken').content).toBe('{broken');
  });
});
