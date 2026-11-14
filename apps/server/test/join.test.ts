import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JoinLookupResponseSchema, JoinResponseSchema, SessionResponseSchema } from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterAll(async () => {
  await t.close();
});

async function startSession(): Promise<{ id: string; joinCode: string }> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { classId: 'class-1a', lessonId: 'g10' },
  });
  const { session } = SessionResponseSchema.parse(res.json());
  return { id: session.id, joinCode: session.joinCode };
}

function codeOf(studentId: string): string[] {
  const row = t.database.db
    .select()
    .from(schema.students)
    .where(eq(schema.students.id, studentId))
    .get();
  if (!row) throw new Error('no student');
  return row.codePublic.split('+');
}

const join = (sessionId: string, studentId: string, code: string[]) =>
  t.app.inject({ method: 'POST', url: '/api/join', payload: { sessionId, studentId, code } });

describe('POST /api/join/lookup', () => {
  it('turns a lesson code into the class list with names only', async () => {
    const { id, joinCode } = await startSession();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/join/lookup',
      payload: { code: joinCode },
    });
    expect(res.statusCode).toBe(200);
    const body = JoinLookupResponseSchema.parse(res.json());
    expect(body.session.id).toBe(id);
    expect(body.class.name).toBe('1А');
    expect(body.codeKind).toBe('pics');
    expect(body.codePics).toHaveLength(6);
    expect(body.students).toHaveLength(20);
    expect(body.students[0]).toEqual({
      id: 'student-01',
      firstName: 'Тимур',
      lastName: 'Алиев',
      sortOrder: 1,
    });
    // no codes or hashes leak to the student page
    expect(JSON.stringify(body)).not.toContain('scrypt');
    expect(Object.keys(body.students[0] ?? {})).not.toContain('code');
  });

  it('rejects an unknown or malformed code', async () => {
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/join/lookup', payload: { code: '0000' } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/join/lookup', payload: { code: 'abc' } }))
        .statusCode,
    ).toBe(400);
  });
});

describe('POST /api/join', () => {
  it('accepts the right picture code, marks attendance and issues a token', async () => {
    const { id } = await startSession();
    const res = await join(id, 'student-01', codeOf('student-01'));
    expect(res.statusCode).toBe(200);
    const body = JoinResponseSchema.parse(res.json());
    expect(body.participantId).toBe('student-01');
    expect(body.token).toHaveLength(32);
    expect(body.student.lastName).toBe('Алиев');

    const attendance = t.database.db
      .select()
      .from(schema.attendance)
      .where(eq(schema.attendance.sessionId, id))
      .all();
    expect(attendance).toEqual([
      expect.objectContaining({ studentId: 'student-01', status: 'present' }) as unknown,
    ]);
    const state = t.app.sessions.getState(id);
    expect(state?.participants['student-01']).toMatchObject({
      name: 'Алиев Тимур',
      number: 1,
      studentId: 'student-01',
    });
  });

  it('rejects a wrong code, counts attempts and locks after five', async () => {
    const { id } = await startSession();
    const right = codeOf('student-05');
    const wrong = [right[1] as string, right[0] as string]; // same pictures, wrong order
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await join(id, 'student-05', wrong);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        error: 'wrong_code',
        details: { attemptsLeft: 5 - attempt },
      });
    }
    const fifth = await join(id, 'student-05', wrong);
    expect(fifth.statusCode).toBe(401);
    expect(fifth.json()).toMatchObject({ error: 'locked' });
    // even the right code is refused while locked
    const locked = await join(id, 'student-05', right);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'locked' });
    expect(locked.json()).toMatchObject({
      details: { retryAfterSec: expect.any(Number) as number },
    });
    // another student is not affected
    expect((await join(id, 'student-06', codeOf('student-06'))).statusCode).toBe(200);
  });

  it('rejects unknown students, ended sessions and students of another class', async () => {
    const { id } = await startSession();
    expect((await join(id, 'nope', ['sun', 'ball'])).statusCode).toBe(404);
    expect((await join('nope', 'student-01', ['sun', 'ball'])).statusCode).toBe(404);
    await t.app.inject({ method: 'POST', url: `/api/sessions/${id}/end`, headers: { cookie } });
    expect((await join(id, 'student-01', codeOf('student-01'))).statusCode).toBe(404);
  });

  it('marks everyone who never joined as absent when the lesson ends', async () => {
    const { id } = await startSession();
    await join(id, 'student-01', codeOf('student-01'));
    await join(id, 'student-02', codeOf('student-02'));
    await t.app.inject({ method: 'POST', url: `/api/sessions/${id}/end`, headers: { cookie } });
    const rows = t.database.db
      .select()
      .from(schema.attendance)
      .where(eq(schema.attendance.sessionId, id))
      .all();
    expect(rows).toHaveLength(20);
    expect(
      rows
        .filter((r) => r.status === 'present')
        .map((r) => r.studentId)
        .sort(),
    ).toEqual(['student-01', 'student-02']);
    expect(rows.filter((r) => r.status === 'absent')).toHaveLength(18);
  });
});
