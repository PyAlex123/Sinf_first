import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClassDetailsResponseSchema,
  DemoStatusSchema,
  JoinLookupResponseSchema,
  JournalSchema,
  MeResponseSchema,
  SessionResponseSchema,
  SessionResultsSchema,
} from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/**
 * S1.15: the demo page — virtual students for the demo lesson, and a reset that touches the demo
 * class alone (ADR-013). On the platform real teachers live beside the demo.
 */

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

async function outsider(): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { fullName: 'Чужой Учитель', email: 'other@example.com', password: 'parol12345' },
  });
  expect(res.statusCode).toBe(200);
  const c = res.cookies.find((x) => x.name === 'sinf_teacher');
  if (!c) throw new Error('no cookie');
  return `${c.name}=${c.value}`;
}

async function startSession(classId = 'class-1a', as = cookie): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie: as },
    payload: { classId, lessonId: 'g10' },
  });
  expect(res.statusCode).toBe(200);
  return SessionResponseSchema.parse(res.json()).session.id;
}

async function addVirtual(sessionId: string, count: number, as = cookie) {
  return t.app.inject({
    method: 'POST',
    url: '/api/demo/virtual',
    headers: { cookie: as },
    payload: { sessionId, count },
  });
}

/** Lets the server's own timer bring them in (they join within 20 seconds). */
function bringIn(): void {
  t.app.virtual.tick(Date.now() + 25_000);
}

describe('demo page', () => {
  it('belongs to the demo teacher only', async () => {
    const other = await outsider();
    for (const [method, url] of [
      ['GET', '/api/demo'],
      ['POST', '/api/demo/reset'],
    ] as const) {
      const res = await t.app.inject({ method, url, headers: { cookie: other } });
      expect(res.statusCode, url).toBe(404);
    }
    const res = await t.app.inject({ method: 'GET', url: '/api/demo', headers: { cookie } });
    expect(DemoStatusSchema.parse(res.json())).toEqual({
      classId: 'class-1a',
      session: null,
      virtualInSession: 0,
      virtualMax: 20,
    });
  });

  it('adds up to twenty virtual students to the demo lesson, no more', async () => {
    const id = await startSession();
    const res = await addVirtual(id, 15);
    expect(res.statusCode).toBe(200);
    expect(DemoStatusSchema.parse(res.json()).virtualInSession).toBe(15);

    const tooMany = await addVirtual(id, 6);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toMatchObject({ error: 'too_many', details: { room: 5 } });
    expect((await addVirtual(id, 21)).statusCode).toBe(400);

    const rest = await addVirtual(id, 5);
    expect(DemoStatusSchema.parse(rest.json()).virtualInSession).toBe(20);

    bringIn();
    const state = t.app.sessions.getState(id);
    const virtual = Object.values(state?.participants ?? {}).filter((p) => p.virtual);
    expect(virtual).toHaveLength(20);
    expect(new Set(virtual.map((p) => p.studentId)).size).toBe(20);
  });

  it('never puts them into a real class', async () => {
    const other = await outsider();
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: { cookie: other },
      payload: { name: '5Б', grade: 5 },
    });
    const classId = created.json<{ class: { id: string } }>().class.id;
    const theirs = await startSession(classId, other);
    // Neither the owner of that class (not the demo teacher) nor the demo teacher may.
    expect((await addVirtual(theirs, 3, other)).statusCode).toBe(404);
    expect((await addVirtual(theirs, 3)).statusCode).toBe(404);
  });

  it('keeps them off the register, the join list and the cards', async () => {
    const id = await startSession();
    await addVirtual(id, 10);
    bringIn();

    const details = ClassDetailsResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/classes/class-1a', headers: { cookie } })
      ).json(),
    );
    expect(details.students).toHaveLength(20);
    expect(details.class.studentCount).toBe(20);
    const me = MeResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json(),
    );
    expect(me.classes.find((c) => c.id === 'class-1a')?.studentCount).toBe(20);

    const joinCode = t.app.sessions.summary(id)?.joinCode;
    const lookup = JoinLookupResponseSchema.parse(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/join/lookup',
          payload: { code: joinCode },
        })
      ).json(),
    );
    expect(lookup.students).toHaveLength(20);
    const asVirtual = await t.app.inject({
      method: 'POST',
      url: '/api/join',
      payload: { sessionId: id, studentId: 'virtual-01', code: ['sun', 'ball'] },
    });
    expect(asVirtual.statusCode).toBe(404);
  });

  it('marks them in results and the journal, and only where they played', async () => {
    const first = await startSession();
    await addVirtual(first, 3);
    bringIn();
    await t.app.inject({ method: 'POST', url: `/api/sessions/${first}/end`, headers: { cookie } });
    // A second lesson without them: they are not "absent" there, they were never in it.
    const second = await startSession();
    await t.app.inject({ method: 'POST', url: `/api/sessions/${second}/end`, headers: { cookie } });

    const results = SessionResultsSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/sessions/${first}/results`,
          headers: { cookie },
        })
      ).json(),
    );
    const virtualRows = results.rows.filter((r) => r.isVirtual);
    expect(virtualRows).toHaveLength(3);
    expect(virtualRows.every((r) => r.present)).toBe(true);
    expect(results.rows).toHaveLength(23);

    const journal = JournalSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/journal/class-1a', headers: { cookie } })
      ).json(),
    );
    const virtualKids = journal.students.filter((s) => s.isVirtual);
    expect(virtualKids).toHaveLength(3);
    expect(virtualKids.every((s) => s.cells[1] === null)).toBe(true);
    const absentInSecond = t.database.db
      .select()
      .from(schema.attendance)
      .all()
      .filter((a) => a.sessionId === second && a.studentId.startsWith('virtual-'));
    expect(absentInSecond).toHaveLength(0);
  });
});

describe('demo reset', () => {
  it('returns class 1А to its start and leaves everybody else alone', async () => {
    const other = await outsider();
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: { cookie: other },
      payload: { name: '5Б', grade: 5 },
    });
    const theirClass = created.json<{ class: { id: string } }>().class.id;
    const theirs = await startSession(theirClass, other);
    await t.app.inject({
      method: 'POST',
      url: `/api/sessions/${theirs}/end`,
      headers: { cookie: other },
    });

    const demo = await startSession();
    await addVirtual(demo, 5);
    bringIn();
    t.database.db
      .update(schema.students)
      .set({ firstName: 'Изменён' })
      .where(eq(schema.students.id, 'student-01'))
      .run();

    const res = await t.app.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, students: 20 });

    const { db } = t.database;
    const students = db.select().from(schema.students).all();
    const demoKids = students.filter((s) => s.classId === 'class-1a');
    expect(demoKids).toHaveLength(20);
    expect(demoKids.some((s) => s.isVirtual)).toBe(false);
    expect(demoKids.find((s) => s.id === 'student-01')?.firstName).toBe('Тимур');
    const sessions = db.select().from(schema.sessions).all();
    expect(sessions.map((s) => s.id)).toEqual([theirs]);
    expect(t.app.sessions.getState(demo)).toBeUndefined();
    expect(t.app.virtual.count(demo)).toBe(0);
    // The other teacher, their class and their lesson are all still there.
    expect(
      db
        .select()
        .from(schema.classes)
        .all()
        .some((c) => c.id === theirClass),
    ).toBe(true);
    expect(
      db
        .select()
        .from(schema.users)
        .all()
        .some((u) => u.email === 'other@example.com'),
    ).toBe(true);
  });
});
