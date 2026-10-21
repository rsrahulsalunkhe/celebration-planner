import { describe, expect, it } from 'vitest';
import { eventRecordSchema } from '@/domain/schemas.ts';
import { daysBetween } from '@/domain/dates.ts';
import { fixedCalendar } from '@/test/helpers.ts';
import { DEMO_PRESETS, buildDemoEvent } from './presets.ts';
import { CATEGORY_TEMPLATES, EXPENSE_TEMPLATES, TASK_TEMPLATES } from './templates.ts';

const preset = (id: string) => {
  const found = DEMO_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`missing preset ${id}`);
  return found;
};

describe('demo presets', () => {
  it('match the specified guests, budgets and lead times', () => {
    const calendar = fixedCalendar('2026-10-21');
    const build = (id: string) =>
      buildDemoEvent(preset(id), { eventId: `e-${id}`, calendar });

    const wedding = build('wedding').profile;
    expect([
      wedding.guestCount,
      wedding.budgetPaise,
      daysBetween('2026-10-21', wedding.date),
    ]).toEqual([200, 50_000_000, 90]);
    expect(wedding.date).toBe('2027-01-19');

    const birthday = build('birthday').profile;
    expect([
      birthday.guestCount,
      birthday.budgetPaise,
      daysBetween('2026-10-21', birthday.date),
    ]).toEqual([40, 5_000_000, 14]);

    const community = build('community');
    expect([
      community.profile.guestCount,
      community.profile.budgetPaise,
      daysBetween('2026-10-21', community.profile.date),
    ]).toEqual([150, 20_000_000, 30]);
    expect(community.profile.setting).toBe('outdoor');
    expect(community.preferences.accessibilityNeeds).toContain('wheelchair-access');
  });

  it('derive dates from the injected calendar, so they never expire', () => {
    const early = buildDemoEvent(preset('wedding'), {
      eventId: 'a',
      calendar: fixedCalendar('2026-10-21'),
    });
    const later = buildDemoEvent(preset('wedding'), {
      eventId: 'b',
      calendar: fixedCalendar('2031-03-05'),
    });
    expect(daysBetween('2031-03-05', later.profile.date)).toBe(90);
    expect(later.profile.date).not.toBe(early.profile.date);
  });

  it('produce schema-valid, clearly labelled records without exact birth dates', () => {
    for (const p of DEMO_PRESETS) {
      const record = buildDemoEvent(p, {
        eventId: `e-${p.id}`,
        calendar: fixedCalendar(),
      });
      expect(eventRecordSchema.safeParse(record).success).toBe(true);
      expect(record.profile.demoPresetId).toBe(p.id);
      expect(record.profile.title.toLowerCase()).toContain('demo');
      expect(record.profile.title.toLowerCase()).toContain('fictional');
    }
    expect(
      buildDemoEvent(preset('birthday'), { eventId: 'b', calendar: fixedCalendar() })
        .profile.ageBand,
    ).toBe('30-49');
  });
});

describe('template catalog', () => {
  const all = [...CATEGORY_TEMPLATES, ...EXPENSE_TEMPLATES, ...TASK_TEMPLATES];

  it('has unique, well-formed, permanent ids', () => {
    const ids = all.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(category|expense|task)\.[a-z0-9-]+$/);
  });

  it('links every expense template to a real category template', () => {
    const categories = new Set(CATEGORY_TEMPLATES.map((c) => c.id));
    for (const e of EXPENSE_TEMPLATES)
      expect(categories.has(e.categoryTemplateId)).toBe(true);
  });

  it('covers every event type with tasks', () => {
    for (const type of ['wedding', 'birthday', 'community'] as const) {
      expect(TASK_TEMPLATES.some((t) => t.appliesTo.includes(type))).toBe(true);
    }
  });
});
