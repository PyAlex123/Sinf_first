import { afterEach, describe, expect, it } from 'vitest';
import { JoinRoomResponseSchema, SessionResponseSchema } from '@sinf/shared';
import { buildApp } from '../src/app.js';
import { schema } from '../src/db/index.js';
import { loginTeacher, testConfig, testContent, testDatabase } from './helpers.js';

/**
 * Stage 3, H2: a student computer in the classroom finds its lesson without a code, and the child
 * who sat there last time is already named.
 */

type App = Awaited<ReturnType<typeof buildApp>>;
const opened: { app: App; close: () => void }[] = [];

async function server(classroom: boolean) {
  const database = testDatabase();
  const app = await buildApp({
    config: testConfig({ CLASSROOM_MODE: classroom ? '1' : '0' }),
    db: database.db,
    content: testContent(),
  });
  await app.ready();
  opened.push({ app, close: () => database.close() });
  return { app, db: database.db, cookie: await loginTeacher(app) };
}

afterEach(async () => {
  for (const { app, close } of opened.splice(0)) {
    await app.close();
    close();
  }
});

async function start(app: App, cookie: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { classId: 'class-1a', lessonId: 'g10' },
  });
  return SessionResponseSchema.parse(res.json()).session.id;
}

async function room(app: App, pc: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/join/room?pc=${encodeURIComponent(pc)}`,
  });
  return {
    status: res.statusCode,
    body: res.statusCode === 200 ? JoinRoomResponseSchema.parse(res.json()) : null,
  };
}

async function join(
  app: App,
  db: ReturnType<typeof testDatabase>['db'],
  sessionId: string,
  studentId: string,
  pc?: string,
) {
  const row = db
    .select()
    .from(schema.students)
    .all()
    .find((s) => s.id === studentId);
  if (!row) throw new Error('no student');
  return app.inject({
    method: 'POST',
    url: '/api/join',
    payload: { sessionId, studentId, code: row.codePublic.split('+'), ...(pc ? { pc } : {}) },
  });
}

describe('classroom lesson without a code', () => {
  it('is not offered on the platform at all', async () => {
    const { app, cookie } = await server(false);
    await start(app, cookie);
    expect((await room(app, 'ПК-05')).status).toBe(404);
  });

  it('says "no lesson yet" until the teacher starts one, then gives the class list', async () => {
    const { app, cookie } = await server(true);
    expect((await room(app, 'ПК-05')).body).toEqual({ lesson: null });

    const id = await start(app, cookie);
    const { body } = await room(app, 'ПК-05');
    expect(body?.lesson?.session.id).toBe(id);
    expect(body?.lesson?.class.name).toBe('1А');
    expect(body?.lesson?.students).toHaveLength(20);
    expect(body?.lesson?.seatedStudentId).toBeNull();
  });

  it('asks for a computer name', async () => {
    const { app } = await server(true);
    expect((await room(app, '')).status).toBe(400);
    expect((await room(app, 'x'.repeat(21))).status).toBe(400);
  });

  it('goes back to "no lesson" when the lesson ends', async () => {
    const { app, cookie } = await server(true);
    const id = await start(app, cookie);
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/end`, headers: { cookie } });
    expect((await room(app, 'ПК-05')).body).toEqual({ lesson: null });
  });
});

describe('seating', () => {
  it('remembers who sat at a computer and names them next lesson', async () => {
    const { app, db, cookie } = await server(true);
    const first = await start(app, cookie);
    expect((await join(app, db, first, 'student-01', 'ПК-05')).statusCode).toBe(200);
    expect((await join(app, db, first, 'student-02', 'ПК-06')).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: `/api/sessions/${first}/end`, headers: { cookie } });

    await start(app, cookie);
    expect((await room(app, 'ПК-05')).body?.lesson?.seatedStudentId).toBe('student-01');
    expect((await room(app, 'ПК-06')).body?.lesson?.seatedStudentId).toBe('student-02');
    expect((await room(app, 'ПК-07')).body?.lesson?.seatedStudentId).toBeNull();
  });

  it('moves a child who changed computers, so the old one asks "who are you?"', async () => {
    const { app, db, cookie } = await server(true);
    const id = await start(app, cookie);
    await join(app, db, id, 'student-01', 'ПК-05');
    await join(app, db, id, 'student-01', 'ПК-09');
    expect((await room(app, 'ПК-09')).body?.lesson?.seatedStudentId).toBe('student-01');
    expect((await room(app, 'ПК-05')).body?.lesson?.seatedStudentId).toBeNull();
  });

  it('gives the computer to whoever logged in there last', async () => {
    const { app, db, cookie } = await server(true);
    const id = await start(app, cookie);
    await join(app, db, id, 'student-01', 'ПК-05');
    await join(app, db, id, 'student-02', 'ПК-05');
    expect((await room(app, 'ПК-05')).body?.lesson?.seatedStudentId).toBe('student-02');
  });

  it('does not remember a seat after a wrong code', async () => {
    const { app, db, cookie } = await server(true);
    const id = await start(app, cookie);
    const res = await app.inject({
      method: 'POST',
      url: '/api/join',
      payload: { sessionId: id, studentId: 'student-01', code: ['x', 'y'], pc: 'ПК-05' },
    });
    expect(res.statusCode).toBe(401);
    expect(db.select().from(schema.seats).all()).toHaveLength(0);
  });

  it('keeps no seats on the platform, where computers are not in a room', async () => {
    const { app, db, cookie } = await server(false);
    const id = await start(app, cookie);
    expect((await join(app, db, id, 'student-01', 'ПК-05')).statusCode).toBe(200);
    expect(db.select().from(schema.seats).all()).toHaveLength(0);
  });
});

describe('the classroom computer in the lesson (H4)', () => {
  it('marks a child who came in from a classroom computer, so "Attention!" is known to be real', async () => {
    const { app, db, cookie } = await server(true);
    const id = await start(app, cookie);
    await join(app, db, id, 'student-01', 'ПК-05');
    await join(app, db, id, 'student-02');
    const state = app.sessions.getState(id);
    expect(state?.participants['student-01']?.pc).toBe('ПК-05');
    expect(state?.participants['student-02']?.pc).toBeNull();

    // Logging in again from another computer moves the mark.
    await join(app, db, id, 'student-01', 'ПК-09');
    expect(app.sessions.getState(id)?.participants['student-01']?.pc).toBe('ПК-09');
  });

  it('never marks anyone on the platform', async () => {
    const { app, db, cookie } = await server(false);
    const id = await start(app, cookie);
    await join(app, db, id, 'student-01', 'ПК-05');
    expect(app.sessions.getState(id)?.participants['student-01']?.pc).toBeNull();
  });
});
