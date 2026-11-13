import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  JoinClassesResponseSchema,
  JoinResponseSchema,
  parseServerMessage,
  SessionResponseSchema,
  type ClientMessage,
  type ServerMessage,
} from '@sinf/shared';
import { schema as schemaRef } from '../src/db/index.js';
import { rawDataToString } from '../src/realtime/ws.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

let t: TestApp;
let baseUrl: string;
let cookie: string;

/** WebSocket client that queues incoming protocol messages. */
class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  readonly socket: WebSocket;
  readonly closed: Promise<number>;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.socket = new WebSocket(url, { headers });
    this.socket.on('message', (data) => {
      const text = rawDataToString(data);
      const message = parseServerMessage(JSON.parse(text));
      if (!message) throw new Error(`Unknown server message: ${text}`);
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.messages.push(message);
    });
    this.closed = new Promise((resolve) => this.socket.on('close', (code) => resolve(code)));
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = this.messages.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for a message')),
        timeoutMs,
      );
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  /** Waits for an update of one participant, skipping other messages. */
  async untilParticipant(
    id: string,
  ): Promise<Extract<ServerMessage, { type: 'participant.updated' }>> {
    for (let i = 0; i < 30; i++) {
      const m = await this.next();
      if (m.type === 'participant.updated' && m.participant.id === id) return m;
    }
    throw new Error(`no participant.updated for ${id}`);
  }

  /** Waits for a message of the given type, skipping others. */
  async until<T extends ServerMessage['type']>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (let i = 0; i < 20; i++) {
      const m = await this.next();
      if (m.type === type) return m as Extract<ServerMessage, { type: T }>;
    }
    throw new Error(`no ${type} message`);
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }
}

const wsUrl = (session: string, role: string, participant?: string): string =>
  `${baseUrl.replace('http', 'ws')}/ws?session=${session}&role=${role}${participant ? `&participant=${participant}` : ''}`;

/** Logs a student in with their seeded picture code and returns the participant token. */
async function joinStudent(sessionId: string, studentId: string): Promise<string> {
  const row = t.database.db
    .select()
    .from(schemaRef.students)
    .all()
    .find((s) => s.id === studentId);
  if (!row) throw new Error('no such student');
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/join',
    payload: { sessionId, studentId, code: row.codePublic.split('+') },
  });
  if (res.statusCode !== 200) throw new Error(`join failed: ${res.statusCode} ${res.body}`);
  return JoinResponseSchema.parse(res.json()).token;
}

beforeAll(async () => {
  t = await testApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const address = t.app.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  cookie = await loginTeacher(t.app);
});

afterAll(async () => {
  await t.close();
});

async function startSession(lessonId = 'g10'): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { classId: 'class-1a', lessonId },
  });
  expect(res.statusCode).toBe(200);
  return SessionResponseSchema.parse(res.json()).session.id;
}

describe('sessions API', () => {
  it('requires a teacher and an existing lesson', async () => {
    const anon = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { classId: 'class-1a', lessonId: 'g10' },
    });
    expect(anon.statusCode).toBe(401);
    const missing = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: 'class-1a', lessonId: 'nope' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('starts a session, shows it on /join/classes and ends the previous one of the class', async () => {
    const first = await startSession('g10');
    const second = await startSession('k10');
    const classes = await t.app.inject({ method: 'GET', url: '/api/join/classes' });
    const body = JoinClassesResponseSchema.parse(classes.json());
    expect(body.classes[0]?.activeSession).toMatchObject({ id: second, lessonId: 'k10' });
    const ended = await t.app.inject({ method: 'GET', url: `/api/join/session/${first}` });
    expect(ended.json()).toMatchObject({ status: 'ended' });

    const end = await t.app.inject({
      method: 'POST',
      url: `/api/sessions/${second}/end`,
      headers: { cookie },
    });
    expect(end.statusCode).toBe(200);
    // The public list holds only classes with a lesson going on (ADR-009), so the class drops out.
    const after = JoinClassesResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/join/classes' })).json(),
    );
    expect(after.classes).toEqual([]);
  });
});

describe('websocket room', () => {
  it('syncs the teacher screen, locks, participants and reconnects by token', async () => {
    const sessionId = await startSession('g10');
    const teacher = new Client(wsUrl(sessionId, 'teacher'), { cookie });
    const snapshot = await teacher.until('state.snapshot');
    expect(snapshot.you).toEqual({ role: 'teacher', participantId: null, participantToken: null });
    expect(snapshot.state).toMatchObject({ mode: 'presentation', screenIndex: 0, screenCount: 28 });

    const token1 = await joinStudent(sessionId, 'student-01');
    const s1 = new Client(wsUrl(sessionId, 'student', token1));
    const s1snap = await s1.until('state.snapshot');
    const p1 = s1snap.you.participantId;
    expect(p1).toBe('student-01');
    expect((await teacher.untilParticipant('student-01')).participant).toMatchObject({
      number: 1,
      online: true,
      name: 'Алиев Тимур',
      studentId: 'student-01',
    });

    const token2 = await joinStudent(sessionId, 'student-02');
    const s2 = new Client(wsUrl(sessionId, 'student', token2));
    const s2snap = await s2.until('state.snapshot');
    expect(Object.keys(s2snap.state.participants)).toHaveLength(2);
    expect(s2snap.state.participants[s2snap.you.participantId ?? '']?.number).toBe(2);
    expect((await teacher.untilParticipant('student-02')).participant).toMatchObject({
      number: 2,
      name: 'Каримова Мадина',
    });

    // teacher flips the screen — both students hear it within a second
    const started = Date.now();
    teacher.send({ v: 1, type: 'teacher.screen.set', index: 5 });
    expect(await s1.until('screen.changed')).toMatchObject({ index: 5 });
    expect(await s2.until('screen.changed')).toMatchObject({ index: 5 });
    expect(Date.now() - started).toBeLessThan(1000);

    // a student cannot flip the teacher's screen
    s1.send({ v: 1, type: 'teacher.screen.set', index: 1 });
    expect(await s1.until('error')).toMatchObject({ code: 'forbidden' });

    // stars and hands reach the teacher
    s1.send({ v: 1, type: 'student.screen.done', index: 5, stars: 3 });
    expect((await teacher.untilParticipant('student-01')).participant).toMatchObject({ stars: 3 });
    s2.send({ v: 1, type: 'student.hand', up: true });
    expect((await teacher.untilParticipant('student-02')).participant).toMatchObject({
      hand: true,
    });

    // lock everybody
    teacher.send({ v: 1, type: 'teacher.lock', targets: 'all', text: 'Смотрите на учителя' });
    expect((await s2.until('lock.changed')).lock.all).toEqual({ text: 'Смотрите на учителя' });

    // student 1 reconnects with the token: same participant, same number, stars kept
    s1.close();
    expect((await teacher.untilParticipant('student-01')).participant).toMatchObject({
      online: false,
    });
    const s1b = new Client(wsUrl(sessionId, 'student', token1));
    const again = await s1b.until('state.snapshot');
    expect(again.you.participantId).toBe(p1);
    expect(again.state.participants[p1 ?? '']).toMatchObject({ number: 1, stars: 3, online: true });

    // teacher state via API matches
    const api = await t.app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
      headers: { cookie },
    });
    expect(api.json()).toMatchObject({
      state: { screenIndex: 5, lock: { all: { text: 'Смотрите на учителя' } } },
    });

    // ending closes everybody
    teacher.send({ v: 1, type: 'teacher.session.end' });
    expect(await s2.until('session.ended')).toMatchObject({ type: 'session.ended' });
    expect(await s2.closed).toBe(1000);
    expect(await s1b.closed).toBe(1000);
    expect(await teacher.closed).toBe(1000);

    const late = new Client(wsUrl(sessionId, 'student', token1));
    expect(await late.until('error')).toMatchObject({ code: 'not_found' });
  });

  it('refuses a teacher socket without the cookie and a projector on a missing session', async () => {
    const sessionId = await startSession('g11');
    const fake = new Client(wsUrl(sessionId, 'teacher'));
    expect(await fake.until('error')).toMatchObject({ code: 'unauthorized' });
    const projector = new Client(wsUrl('nope', 'projector'));
    expect(await projector.until('error')).toMatchObject({ code: 'not_found' });
    const ok = new Client(wsUrl(sessionId, 'projector'));
    expect((await ok.until('state.snapshot')).you.role).toBe('projector');
    ok.close();
    await t.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/end`,
      headers: { cookie },
    });
  });
});
