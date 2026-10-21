import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../dates.ts';
import {
  CATCH_UP_TASKS_PER_DAY,
  idealDeadline,
  scheduleTasks,
  summarizeSchedule,
  urgencyOf,
  validateTaskTemplates,
  type SchedulableTask,
} from './deadlines.ts';
import { findCycle, orderByDependencies } from './graph.ts';
import type { TaskTemplate } from './types.ts';

const before = (
  id: string,
  days: number,
  extra: Partial<SchedulableTask> = {},
): SchedulableTask => ({
  id,
  timing: { kind: 'before', days },
  importance: 'important',
  dependsOn: [],
  ...extra,
});
const after = (
  id: string,
  days: number,
  extra: Partial<SchedulableTask> = {},
): SchedulableTask => ({
  id,
  timing: { kind: 'after', days },
  importance: 'routine',
  dependsOn: [],
  ...extra,
});

const schedule = (
  eventDate: string,
  today: string,
  tasks: SchedulableTask[],
  horizonDays = 30,
) => scheduleTasks({ eventDate, today, horizonDays, tasks });

describe('ideal deadlines on calendar dates', () => {
  it('handles month ends, leap days and year ends', () => {
    expect(idealDeadline('2026-11-01', { kind: 'before', days: 1 })).toBe('2026-10-31');
    expect(idealDeadline('2027-03-01', { kind: 'before', days: 1 })).toBe('2027-02-28');
    expect(idealDeadline('2028-03-01', { kind: 'before', days: 1 })).toBe('2028-02-29'); // leap day
    expect(idealDeadline('2028-03-01', { kind: 'before', days: 2 })).toBe('2028-02-28');
    expect(idealDeadline('2027-01-02', { kind: 'before', days: 5 })).toBe('2026-12-28');
    expect(idealDeadline('2028-02-28', { kind: 'after', days: 1 })).toBe('2028-02-29');
    expect(idealDeadline('2028-02-28', { kind: 'after', days: 2 })).toBe('2028-03-01');
    expect(idealDeadline('2027-02-28', { kind: 'after', days: 1 })).toBe('2027-03-01'); // no leap day
  });

  it('is not shifted by daylight saving or the time zone', () => {
    expect(idealDeadline('2027-03-29', { kind: 'before', days: 30 })).toBe('2027-02-27');
    expect(idealDeadline('2027-11-01', { kind: 'before', days: 30 })).toBe('2027-10-02');
  });
});

describe('scheduling when time is short', () => {
  it('keeps the ideal deadline and uses it when there is time', () => {
    const [t] = schedule('2026-12-01', '2026-10-21', [before('a', 14)]);
    expect(t).toMatchObject({
      idealDate: '2026-11-17',
      dueDate: '2026-11-17',
      behindIdeal: false,
      reason: 'on-schedule',
    });
  });

  it('today: an event today puts every preparation step due today, none after the event', () => {
    const result = schedule('2026-10-21', '2026-10-21', [
      before('a', 14),
      before('b', 1),
      before('c', 0),
    ]);
    for (const t of result) expect(t.dueDate).toBe('2026-10-21');
    expect(result.find((t) => t.id === 'a')?.idealDate).toBe('2026-10-07'); // ideal preserved
    expect(result.find((t) => t.id === 'a')?.behindIdeal).toBe(true);
    expect(result.find((t) => t.id === 'c')?.behindIdeal).toBe(false);
  });

  it('tomorrow: one day left schedules catch-up for today or tomorrow, never later', () => {
    const result = schedule('2026-10-22', '2026-10-21', [
      before('critical-1', 14, { importance: 'critical' }),
      before('critical-2', 14, { importance: 'critical' }),
      before('critical-3', 14, { importance: 'critical' }),
      before('later', 14),
    ]);
    for (const t of result) {
      expect(t.dueDate >= '2026-10-21').toBe(true);
      expect(t.dueDate <= '2026-10-22').toBe(true);
    }
    expect(result.find((t) => t.id === 'critical-3')?.dueDate).toBe('2026-10-22'); // third critical slips a day
    expect(result.find((t) => t.id === 'critical-3')?.idealDate).toBe('2026-10-08');
  });

  it('spreads critical catch-up work at a fixed number per day, in dependency order', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e'].map((id, i, all) =>
      before(id, 45, {
        importance: 'critical',
        dependsOn: i === 0 ? [] : [all[i - 1] ?? ''],
      }),
    );
    const result = schedule('2026-11-30', '2026-10-21', tasks);
    const perDay = CATCH_UP_TASKS_PER_DAY;
    result.forEach((t, i) => {
      expect(t.reason).toBe('catch-up-immediate');
      expect(t.dueDate).toBe(`2026-10-${21 + Math.floor(i / perDay)}`);
    });
  });

  it('compresses non-critical steps in proportion to the time left', () => {
    // 15 of 30 horizon days left, so a 20-day lead becomes about 10 days.
    const [t] = schedule('2026-11-05', '2026-10-21', [before('a', 20)], 30);
    expect(t?.reason).toBe('compressed');
    expect(t?.idealDate).toBe('2026-10-16');
    expect(t?.dueDate).toBe('2026-10-26'); // 10 days before the event
    expect(t?.explanation).toContain('compressed');
  });

  it('never schedules before today or after the event for preparation work', () => {
    for (const daysLeft of [0, 1, 2, 5, 13, 29, 60]) {
      const eventDate = addDays('2026-10-21', daysLeft);
      const left = daysLeft;
      const result = schedule(eventDate, '2026-10-21', [
        before('a', 40, { importance: 'critical' }),
        before('b', 25),
        before('c', 3, { dependsOn: ['a'] }),
        before('d', 0),
      ]);
      for (const t of result) {
        expect(t.dueDate >= '2026-10-21').toBe(true);
        expect(t.dueDate <= eventDate).toBe(true);
        expect(daysBetween('2026-10-21', t.dueDate)).toBeLessThanOrEqual(left);
      }
    }
  });

  it('a step never falls due before a step it depends on', () => {
    const result = schedule('2026-11-30', '2026-10-21', [
      before('first', 20, { importance: 'critical' }),
      before('second', 40, { importance: 'critical' }),
      before('dependent', 35, { dependsOn: ['first', 'second'] }),
    ]);
    const due = Object.fromEntries(result.map((t) => [t.id, t.dueDate]));
    expect(due.dependent && due.first && due.dependent >= due.first).toBe(true);
    expect(due.dependent && due.second && due.dependent >= due.second).toBe(true);
  });

  it('even a preparation step that (wrongly) depends on a follow-up is never due after the event', () => {
    // Templates are validated to prevent this, but the scheduler must still hold the guarantee.
    const result = schedule('2026-11-01', '2026-10-21', [
      after('follow-up', 7),
      before('prep', 10, { dependsOn: ['follow-up'] }),
    ]);
    const prep = result.find((t) => t.id === 'prep');
    expect(prep?.dueDate).toBe('2026-11-01');
    expect(result.find((t) => t.id === 'follow-up')?.dueDate).toBe('2026-11-08');
  });

  it('follow-ups after the event may be later, and are never marked behind', () => {
    const [t] = schedule('2026-11-01', '2026-10-21', [after('thanks', 7)]);
    expect(t).toMatchObject({
      kind: 'follow-up',
      dueDate: '2026-11-08',
      behindIdeal: false,
      reason: 'follow-up',
    });
    const [leap] = schedule('2028-02-28', '2028-02-01', [after('thanks', 1)]);
    expect(leap?.dueDate).toBe('2028-02-29');
  });

  it('explains the compressed schedule and counts the steps that are behind', () => {
    const result = schedule('2026-11-05', '2026-10-21', [
      before('a', 20),
      before('b', 5),
    ]);
    const summary = summarizeSchedule(result, 15);
    expect(summary).toMatchObject({
      behindCount: 1,
      compressed: true,
      daysUntilEvent: 15,
    });
    expect(summary.explanation).toContain('1 of 2 steps');
    expect(summarizeSchedule([], 15).compressed).toBe(false);
  });

  it('rejects an event that has already passed', () => {
    expect(() => schedule('2026-10-20', '2026-10-21', [before('a', 1)])).toThrow(
      RangeError,
    );
  });

  it('is deterministic', () => {
    const run = () =>
      schedule('2026-11-30', '2026-10-21', [
        before('a', 40, { importance: 'critical' }),
        before('b', 10),
      ]);
    expect(run()).toEqual(run());
  });
});

describe('urgency is derived from today, not stored', () => {
  const task = (dueDate: string, status: 'todo' | 'done' = 'todo') => ({
    dueDate,
    status,
  });
  it('classifies a task relative to today', () => {
    expect(urgencyOf(task('2026-10-20'), '2026-10-21')).toBe('overdue');
    expect(urgencyOf(task('2026-10-21'), '2026-10-21')).toBe('due-today');
    expect(urgencyOf(task('2026-10-22'), '2026-10-21')).toBe('due-soon');
    expect(urgencyOf(task('2026-10-28'), '2026-10-21')).toBe('due-soon');
    expect(urgencyOf(task('2026-10-29'), '2026-10-21')).toBe('upcoming');
    expect(urgencyOf(task('2026-10-01', 'done'), '2026-10-21')).toBe('done');
    // Month end and leap day.
    expect(urgencyOf(task('2026-11-01'), '2026-10-31')).toBe('due-soon');
    expect(urgencyOf(task('2028-02-29'), '2028-02-28')).toBe('due-soon');
    expect(urgencyOf(task('2028-02-28'), '2028-02-29')).toBe('overdue');
  });
});

describe('dependencies and cycles', () => {
  it('orders dependencies first and keeps input order otherwise', () => {
    const { order, cycle } = orderByDependencies([
      { id: 'c', dependsOn: ['a', 'b'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'a', dependsOn: [] },
      { id: 'd', dependsOn: [] },
    ]);
    expect(cycle).toBeNull();
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('detects a cycle and names it', () => {
    const cycle = findCycle([
      { id: 'a', dependsOn: ['c'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
      { id: 'free', dependsOn: [] },
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']));
    expect(findCycle([{ id: 'a', dependsOn: ['a'] }])).toEqual(['a', 'a']);
  });

  it('the scheduler refuses a cyclic list', () => {
    expect(() =>
      schedule('2026-12-01', '2026-10-21', [
        before('a', 10, { dependsOn: ['b'] }),
        before('b', 10, { dependsOn: ['a'] }),
      ]),
    ).toThrow(/cycle/);
  });

  it('validates task templates: cycles, unknown ids, impossible orderings', () => {
    const tpl = (
      id: string,
      kind: 'before' | 'after',
      days: number,
      dependsOn: string[] = [],
    ): TaskTemplate => ({
      id,
      title: id,
      timing: { kind, days },
      importance: 'routine',
      category: 'planning',
      dependsOn,
      rationale: 'r',
    });
    expect(
      validateTaskTemplates([
        tpl('task.a', 'before', 10),
        tpl('task.b', 'before', 5, ['task.a']),
      ]),
    ).toEqual([]);
    expect(
      validateTaskTemplates([
        tpl('task.a', 'before', 10, ['task.b']),
        tpl('task.b', 'before', 10, ['task.a']),
      ]).join(),
    ).toMatch(/cycle/);
    expect(
      validateTaskTemplates([tpl('task.a', 'before', 10, ['task.zzz'])]).join(),
    ).toMatch(/unknown task/);
    expect(
      validateTaskTemplates([tpl('task.a', 'before', 10, ['task.a'])]).join(),
    ).toMatch(/itself/);
    expect(
      validateTaskTemplates([
        tpl('task.a', 'before', 5),
        tpl('task.b', 'before', 10, ['task.a']),
      ]).join(),
    ).toMatch(/before its dependency/);
    expect(
      validateTaskTemplates([
        tpl('task.a', 'after', 5),
        tpl('task.b', 'before', 10, ['task.a']),
      ]).join(),
    ).toMatch(/later step/);
    expect(
      validateTaskTemplates([
        tpl('task.a', 'before', 5),
        tpl('task.a', 'before', 5),
      ]).join(),
    ).toMatch(/Duplicate/);
  });
});

describe('event-day steps and completed steps', () => {
  it('schedules an event-day step on the event date, distinct from preparation', () => {
    const [day] = schedule('2026-11-20', '2026-10-21', [
      { id: 'run', timing: { kind: 'on-day' }, importance: 'critical', dependsOn: [] },
    ]);
    expect(day).toMatchObject({
      kind: 'event-day',
      dueDate: '2026-11-20',
      reason: 'event-day',
    });
    expect(idealDeadline('2026-11-20', { kind: 'on-day' })).toBe('2026-11-20');
  });

  it('gives catch-up slots only to steps that are not done', () => {
    const critical = { importance: 'critical' as const };
    const result = schedule('2026-10-26', '2026-10-21', [
      before('done-1', 30, { ...critical, done: true }),
      before('done-2', 30, { ...critical, done: true }),
      before('open-1', 25, critical),
      before('open-2', 25, critical),
      before('open-3', 25, critical),
    ]);
    const due = Object.fromEntries(result.map((t) => [t.id, t.dueDate]));
    expect(due['open-1']).toBe('2026-10-21');
    expect(due['open-2']).toBe('2026-10-21');
    expect(due['open-3']).toBe('2026-10-22');
    expect(result.find((t) => t.id === 'done-1')?.explanation).toMatch(/Completed/);
  });
});
