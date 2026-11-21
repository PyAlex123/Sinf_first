import { afterEach, describe, expect, it } from 'vitest';
import {
  JoinResponseSchema,
  PROTOCOL_VERSION,
  SessionResponseSchema,
  SessionResultsSchema,
  type ServerMessage,
} from '@sinf/shared';
import { buildApp } from '../src/app.js';
import { schema } from '../src/db/index.js';
import type { RoomSocket } from '../src/realtime/session-store.js';
import { loginTeacher, testConfig, testContent, testDatabase } from './helpers.js';

/**
 * Stage 3, H5: screens of classroom computers. Thumbnails go to the teacher's screens only and only
 * while a teacher watches; screenshots are uploaded with the child's lesson token and shown in the
 * results gallery.
 */

type App = Awaited<ReturnType<typeof buildApp>>;
const opened: { app: App; close: () => void }[] = [];

afterEach(async () => {
  for (const { app, close } of opened.splice(0)) {
    for (const id of app.sessions.liveSessionIds()) app.sessions.end(id);
    await app.close();
    close();
  }
});

async function server(classroom = true) {
  const database = testDatabase();
  const config = testConfig({
    CLASSROOM_MODE: classroom ? '1' : '0',
    DATA_DIR: `/tmp/claude-0/sinf-screens-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  const app = await buildApp({ config, db: database.db, content: testContent() });
  await app.ready();
  opened.push({ app, close: () => database.close() });
  const cookie = await loginTeacher(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { classId: 'class-1a', lessonId: 'k10' },
  });
  const sessionId = SessionResponseSchema.parse(res.json()).session.id;
  return { app, db: database.db, cookie, sessionId };
}

/** A socket that keeps what the room sends to it. */
function socket(): RoomSocket & { got: ServerMessage[] } {
  const got: ServerMessage[] = [];
  return {
    got,
    readyState: 1,
    OPEN: 1,
    send: (data: string) => got.push(JSON.parse(data) as ServerMessage),
    close: () => undefined,
    ping: () => undefined,
    terminate: () => undefined,
  };
}

async function joinChild(
  app: App,
  db: ReturnType<typeof testDatabase>['db'],
  sessionId: string,
  studentId: string,
  pc = 'ПК-05',
) {
  const row = db
    .select()
    .from(schema.students)
    .all()
    .find((s) => s.id === studentId);
  if (!row) throw new Error('no student');
  const res = await app.inject({
    method: 'POST',
    url: '/api/join',
    payload: { sessionId, studentId, code: row.codePublic.split('+'), pc },
  });
  return JoinResponseSchema.parse(res.json()).token;
}

/** The smallest valid-looking JPEG: the magic bytes and some padding. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString(
  'base64',
);

const of = (s: { got: ServerMessage[] }, type: ServerMessage['type']) =>
  s.got.filter((m) => m.type === type);

describe('thumbnails', () => {
  it('are wanted only while a teacher watches, and reach teachers only', async () => {
    const { app, db, sessionId } = await server();
    const token = await joinChild(app, db, sessionId, 'student-01');
    const store = app.sessions;

    const child = socket();
    store.attach(sessionId, child, 'student', token);
    expect(of(child, 'thumbs.wanted').at(-1)).toMatchObject({ on: false });

    const teacher = socket();
    store.attach(sessionId, teacher, 'teacher', null);
    expect(of(child, 'thumbs.wanted').at(-1)).toMatchObject({ on: true });

    const other = socket();
    store.attach(sessionId, other, 'student', await joinChild(app, db, sessionId, 'student-02'));
    store.dispatch(sessionId, child, {
      kind: 'command',
      role: 'student',
      participantId: 'student-01',
      message: { v: PROTOCOL_VERSION, type: 'student.thumb', jpeg: 'AAAA' },
      now: Date.now(),
    });
    expect(of(teacher, 'thumb')).toEqual([
      { v: 1, type: 'thumb', participantId: 'student-01', jpeg: 'AAAA' },
    ]);
    expect(of(other, 'thumb')).toHaveLength(0);

    // Faster than one in three seconds: dropped.
    store.dispatch(sessionId, child, {
      kind: 'command',
      role: 'student',
      participantId: 'student-01',
      message: { v: PROTOCOL_VERSION, type: 'student.thumb', jpeg: 'BBBB' },
      now: Date.now(),
    });
    expect(of(teacher, 'thumb')).toHaveLength(1);

    store.detach(sessionId, teacher);
    expect(of(child, 'thumbs.wanted').at(-1)).toMatchObject({ on: false });
  });
});

describe('a second computer', () => {
  it('closes the first one and tells the teachers only', async () => {
    const { app, db, sessionId } = await server();
    const store = app.sessions;
    const teacher = socket();
    store.attach(sessionId, teacher, 'teacher', null);
    const first = socket();
    store.attach(sessionId, first, 'student', await joinChild(app, db, sessionId, 'student-01'));
    const classmate = socket();
    store.attach(
      sessionId,
      classmate,
      'student',
      await joinChild(app, db, sessionId, 'student-02', 'ПК-07'),
    );
    expect(of(teacher, 'student.moved')).toHaveLength(0);

    await joinChild(app, db, sessionId, 'student-01', 'ПК-06');
    expect(of(first, 'session.kicked')).toHaveLength(1);
    expect(of(teacher, 'student.moved')).toEqual([
      { v: 1, type: 'student.moved', participantId: 'student-01', from: 'ПК-05', to: 'ПК-06' },
    ]);
    expect(of(classmate, 'student.moved')).toHaveLength(0);

    // Logging in again with nothing left open (a reload) is no news.
    await joinChild(app, db, sessionId, 'student-01', 'ПК-06');
    expect(of(teacher, 'student.moved')).toHaveLength(1);
  });
});

describe('screenshots', () => {
  it('are uploaded with the lesson token and shown to the teacher', async () => {
    const { app, db, cookie, sessionId } = await server();
    const token = await joinChild(app, db, sessionId, 'student-01');
    const up = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/screenshots`,
      headers: { 'x-participant-token': token },
      payload: { jpeg: JPEG, width: 1366, height: 768, reason: 'before_end' },
    });
    expect(up.statusCode).toBe(200);
    const { id } = up.json<{ id: string }>();

    const picture = await app.inject({
      method: 'GET',
      url: `/api/screenshots/${id}`,
      headers: { cookie },
    });
    expect(picture.statusCode).toBe(200);
    expect(picture.headers['content-type']).toBe('image/jpeg');
    expect(picture.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const results = SessionResultsSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/sessions/${sessionId}/results`,
          headers: { cookie },
        })
      ).json(),
    );
    expect(results.rows.find((r) => r.studentId === 'student-01')?.screenshotId).toBe(id);
    expect(results.rows.find((r) => r.studentId === 'student-02')?.screenshotId ?? null).toBeNull();
  });

  it('refuse a stranger, a non-picture and a flood', async () => {
    const { app, db, sessionId } = await server();
    const send = (headers: Record<string, string>, jpeg = JPEG) =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/screenshots`,
        headers,
        payload: { jpeg, width: 100, height: 100, reason: 'manual' },
      });
    expect((await send({})).statusCode).toBe(401);
    expect((await send({ 'x-participant-token': 'nonsense' })).statusCode).toBe(401);
    const token = await joinChild(app, db, sessionId, 'student-01');
    expect(
      (await send({ 'x-participant-token': token }, Buffer.from('hello').toString('base64')))
        .statusCode,
    ).toBe(400);
    expect((await send({ 'x-participant-token': token })).statusCode).toBe(200);
    expect((await send({ 'x-participant-token': token })).statusCode).toBe(429);
  });

  it('are not taken on the platform', async () => {
    const { app, db, sessionId } = await server(false);
    const token = await joinChild(app, db, sessionId, 'student-01');
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/screenshots`,
      headers: { 'x-participant-token': token },
      payload: { jpeg: JPEG, width: 100, height: 100, reason: 'manual' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('are shown to nobody but a teacher of the class', async () => {
    const { app, db, sessionId } = await server();
    const token = await joinChild(app, db, sessionId, 'student-01');
    const up = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/screenshots`,
      headers: { 'x-participant-token': token },
      payload: { jpeg: JPEG, width: 100, height: 100, reason: 'manual' },
    });
    const { id } = up.json<{ id: string }>();
    expect((await app.inject({ method: 'GET', url: `/api/screenshots/${id}` })).statusCode).toBe(
      401,
    );
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'Чужой Учитель', email: 'other@example.com', password: 'parol12345' },
    });
    const c = reg.cookies.find((x) => x.name === 'sinf_teacher');
    const res = await app.inject({
      method: 'GET',
      url: `/api/screenshots/${id}`,
      headers: { cookie: `${c?.name}=${c?.value}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
