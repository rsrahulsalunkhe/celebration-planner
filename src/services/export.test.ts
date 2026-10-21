import { describe, expect, it } from 'vitest';
import { sampleWedding } from '@/data/fixtures.ts';
import { persistedPlannerSchema } from '@/domain/schemas.ts';
import { buildJsonExport } from './export.ts';

describe('buildJsonExport', () => {
  it('produces a valid versioned envelope with a safe filename', () => {
    const file = buildJsonExport({ event: sampleWedding });
    expect(file.filename).toBe('meera-arjun-s-wedding.json');
    expect(file.mimeType).toBe('application/json');
    const parsed = persistedPlannerSchema.safeParse(JSON.parse(file.content));
    expect(parsed.success).toBe(true);
  });

  it('falls back to a generic name without an event', () => {
    expect(buildJsonExport({ event: null }).filename).toBe('celebration-plan.json');
  });
});
