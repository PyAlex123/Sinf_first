import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClassProgramSchema,
  ProgramListResponseSchema,
  ProgramSchema,
  SessionResponseSchema,
  type Program,
} from '@sinf/shared';
import { buildSchoolSnapshot } from '../src/sync/snapshot.js';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** W7 (PLAN.md 3.8): programmes by quarters, a class's programme and its next lesson. */

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  for (const id of t.app.sessions.liveSessionIds()) t.app.sessions.end(id);
  await t.close();
});

const json = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload } : {}) });

async function programWith(lessons: [string, number][]): Promise<Program> {
  const made = ProgramSchema.parse(
    (await json('POST', '/api/programs', { title: '1 класс', grade: 1 })).json(),
  );
  const saved = await json('PUT', `/api/programs/${made.id}`, {
    title: made.title,
    grade: 1,
    visibility: 'private',
    items: lessons.map(([lessonId, quarter]) => ({ lessonId, quarter })),
    version: made.version,
  });
  expect(saved.statusCode).toBe(200);
  return ProgramSchema.parse(saved.json());
}

describe('a programme', () => {
  it('holds the author’s and the teacher’s lessons by quarter, with their titles', async () => {
    const own = (
      await json('POST', '/api/authored-lessons', { title: 'Мой урок', grade: 1 })
    ).json<{ id: string }>();
    const program = await programWith([
      ['g10', 2],
      ['k10', 2],
      [own.id, 3],
    ]);
    expect(program.items.map((i) => [i.title, i.quarter])).toEqual([
      ['Предыдущий — последующий', 2],
      ['Радуга', 2],
      ['Мой урок', 3],
    ]);
    expect(program.lessons).toBe(3);

    // A lesson that does not exist is refused: a typo would be a hole in the year.
    const bad = await json('PUT', `/api/programs/${program.id}`, {
      title: 'x',
      grade: 1,
      visibility: 'private',
      items: [{ lessonId: 'nope', quarter: 1 }],
      version: program.version,
    });
    expect(bad.statusCode).toBe(400);

    const list = ProgramListResponseSchema.parse((await json('GET', '/api/programs')).json());
    expect(list.programs.map((p) => p.id)).toEqual([program.id]);
  });

  it('tells a class its next lesson, and moves on as lessons are held', async () => {
    const program = await programWith([
      ['g10', 2],
      ['k10', 2],
      ['g11', 2],
    ]);
    const set = await json('PUT', '/api/classes/class-1a/program', { programId: program.id });
    expect(ClassProgramSchema.parse(set.json()).next?.lessonId).toBe('g10');

    // A lesson held out of order still counts as had.
    const started = await json('POST', '/api/sessions', { classId: 'class-1a', lessonId: 'k10' });
    SessionResponseSchema.parse(started.json());
    let now = ClassProgramSchema.parse((await json('GET', '/api/classes/class-1a/program')).json());
    expect(now.items.map((i) => i.done)).toEqual([false, true, false]);
    expect(now.next?.lessonId).toBe('g10');

    await json('POST', '/api/sessions', { classId: 'class-1a', lessonId: 'g10' });
    now = ClassProgramSchema.parse((await json('GET', '/api/classes/class-1a/program')).json());
    expect(now.next?.lessonId).toBe('g11');

    // Deleting the programme leaves the class without one.
    await json('DELETE', `/api/programs/${program.id}`);
    now = ClassProgramSchema.parse((await json('GET', '/api/classes/class-1a/program')).json());
    expect(now).toEqual({ program: null, items: [], next: null });
  });

  it('travels to the school computer with the roster', async () => {
    const program = await programWith([['g10', 1]]);
    await json('PUT', '/api/classes/class-1a/program', { programId: program.id });
    const snapshot = buildSchoolSnapshot(t.database.db, DEMO.schoolId);
    expect(snapshot?.classes.find((c) => c.id === 'class-1a')?.programId).toBe(program.id);
    expect(snapshot?.programs?.map((p) => [p.id, p.items])).toEqual([
      [program.id, [{ lessonId: 'g10', quarter: 1 }]],
    ]);
  });
});
