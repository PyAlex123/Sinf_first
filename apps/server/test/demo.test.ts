import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeFrame,
  JoinResponseSchema,
  parseFrame,
  PROTOCOL_VERSION,
  SessionResponseSchema,
  type ClientMessage,
  type ServerMessage,
} from '@sinf/shared';
import { buildApp } from '../src/app.js';
import type { DemoSource } from '../src/realtime/demo-relay.js';
import type { RoomSocket } from '../src/realtime/session-store.js';
import { loginTeacher, testConfig, testContent, testDatabase } from './helpers.js';

/** H14: a screen broadcast — who may send it, who gets it, and a viewer who cannot keep up. */

type App = Awaited<ReturnType<typeof buildApp>>;
const opened: { app: App; close: () => void }[] = [];

afterEach(async () => {
  for (const { app, close } of opened.splice(0)) {
    for (const id of app.sessions.liveSessionIds()) app.sessions.end(id);
    await app.close();
    close();
  }
});

interface Sock extends RoomSocket {
  text: ServerMessage[];
  frames: Uint8Array[];
  bufferedAmount: number;
}

function socket(): Sock {
  const s: Sock = {
    text: [],
    frames: [],
    bufferedAmount: 0,
    readyState: 1,
    OPEN: 1,
    send(data) {
      if (typeof data === 'string') s.text.push(JSON.parse(data) as ServerMessage);
      else s.frames.push(data);
    },
    close: () => undefined,
    ping: () => undefined,
    terminate: () => undefined,
  };
  return s;
}

function source(): DemoSource & { said: string[]; closed: boolean } {
  const s = {
    said: [] as string[],
    closed: false,
    tell: (m: string) => s.said.push(m),
    close: () => {
      s.closed = true;
    },
  };
  return s;
}

const frame = (keyframe: boolean, seq = 1) =>
  encodeFrame({
    keyframe,
    epoch: 0,
    seq,
    width: 1280,
    height: 720,
    cursor: null,
    rects: [{ x: 0, y: 0, w: 80, h: 80, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 1]) }],
  });

async function lesson() {
  const database = testDatabase();
  const app = await buildApp({
    config: testConfig({ CLASSROOM_MODE: '1' }),
    db: database.db,
    content: testContent(),
  });
  await app.ready();
  opened.push({ app, close: () => database.close() });
  const cookie = await loginTeacher(app);
  const sessionId = SessionResponseSchema.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { cookie },
        payload: { classId: 'class-1a', lessonId: 'k10' },
      })
    ).json(),
  ).session.id;
  const store = app.sessions;
  const students = await Promise.all(
    ['student-01', 'student-02', 'student-03'].map(async (id, i) => {
      const row = database.db.query.students
        .findFirst({ where: (s, { eq }) => eq(s.id, id) })
        .sync();
      const res = await app.inject({
        method: 'POST',
        url: '/api/join',
        payload: { sessionId, studentId: id, code: row?.codePublic.split('+'), pc: `ПК-0${i + 1}` },
      });
      const { token } = JoinResponseSchema.parse(res.json());
      const sock = socket();
      store.attach(sessionId, sock, 'student', token);
      return { id, sock, token };
    }),
  );
  const teacher = socket();
  store.attach(sessionId, teacher, 'teacher', null);
  const projector = socket();
  store.attach(sessionId, projector, 'projector', null);
  const command = (message: ClientMessage) =>
    store.dispatch(sessionId, teacher, {
      kind: 'command',
      role: 'teacher',
      participantId: null,
      message,
      now: Date.now(),
    });
  return { app, store, sessionId, students, teacher, projector, command, relay: app.demo };
}

describe('a screen broadcast', () => {
  it('sends the teacher’s screen to every child and the projector, stamped with this broadcast', async () => {
    const l = await lesson();
    expect(l.relay.canSource(l.sessionId, 'teacher')).toBe(false);
    l.command({
      v: PROTOCOL_VERSION,
      type: 'teacher.demo.start',
      mode: 'fullscreen',
      source: 'teacher',
    });
    const demo = l.store.getState(l.sessionId)?.demo;
    expect(demo).toMatchObject({ mode: 'fullscreen', source: 'teacher' });
    expect(l.students[0]?.sock.text.some((m) => m.type === 'demo.changed')).toBe(true);
    expect(l.relay.canSource(l.sessionId, 'teacher')).toBe(true);

    const host = source();
    l.relay.attachSource(l.sessionId, 'teacher', host);
    expect(host.said).toEqual(['keyframe']);
    expect(l.relay.frame(l.sessionId, host, frame(true))).toBeNull();
    for (const s of l.students) {
      expect(s.sock.frames).toHaveLength(1);
      expect(parseFrame(s.sock.frames[0] ?? new Uint8Array())?.epoch).toBe(demo?.epoch);
    }
    expect(l.projector.frames).toHaveLength(1);
    // The teacher does not need their own screen back.
    expect(l.teacher.frames).toHaveLength(0);
  });

  it('drops frames of nobody, broken frames and a flood', async () => {
    const l = await lesson();
    const stranger = source();
    expect(l.relay.frame(l.sessionId, stranger, frame(true))).toBe('not the source');
    l.command({
      v: PROTOCOL_VERSION,
      type: 'teacher.demo.start',
      mode: 'window',
      source: 'teacher',
    });
    const host = source();
    l.relay.attachSource(l.sessionId, 'teacher', host);
    const bad = frame(true);
    bad[0] = 0;
    expect(l.relay.frame(l.sessionId, host, bad)).toBe('bad frame');
    expect(l.relay.frame(l.sessionId, host, frame(false, 1))).toBeNull();
    expect(l.relay.frame(l.sessionId, host, frame(false, 2))).toBe('too fast');
    expect(l.students[0]?.sock.frames).toHaveLength(1);
  });

  it('shows a child’s screen only from a classroom computer, to everybody but that child', async () => {
    const l = await lesson();
    const [aliev, karimova] = l.students;
    if (!aliev || !karimova) throw new Error('no students');
    l.command({
      v: PROTOCOL_VERSION,
      type: 'teacher.demo.start',
      mode: 'fullscreen',
      source: aliev.id,
    });
    expect(l.relay.canSource(l.sessionId, aliev.id)).toBe(true);
    expect(l.relay.canSource(l.sessionId, karimova.id)).toBe(false);
    const app = source();
    l.relay.attachSource(l.sessionId, aliev.id, app);
    l.relay.frame(l.sessionId, app, frame(true));
    expect(aliev.sock.frames).toHaveLength(0);
    expect(karimova.sock.frames).toHaveLength(1);
    expect(l.teacher.frames).toHaveLength(1);

    // Another child's screen next: the first app is told to stop.
    l.command({
      v: PROTOCOL_VERSION,
      type: 'teacher.demo.start',
      mode: 'fullscreen',
      source: karimova.id,
    });
    expect(app.said.at(-1)).toBe('stop');
    expect(app.closed).toBe(true);
    // Stopping clears it for everybody.
    l.command({ v: PROTOCOL_VERSION, type: 'teacher.demo.stop' });
    expect(l.store.getState(l.sessionId)?.demo).toBeNull();
  });

  it('refuses a child in a browser: a browser cannot film its screen', async () => {
    const l = await lesson();
    const p = l.store.getState(l.sessionId)?.participants['student-01'];
    if (!p) throw new Error('no participant');
    // Make it a browser participant by taking its computer away.
    l.store.getState(l.sessionId)!.participants['student-01'] = { ...p, pc: null };
    l.command({
      v: PROTOCOL_VERSION,
      type: 'teacher.demo.start',
      mode: 'fullscreen',
      source: 'student-01',
    });
    expect(l.store.getState(l.sessionId)?.demo).toBeNull();
  });

  it('lets a slow viewer skip frames until a whole picture, and asks the source for one', async () => {
    let now = 1_000_000;
    const l = await lesson();
    // The relay's clock, so the test decides what "a second later" is.
    (l.relay as unknown as { now: () => number }).now = () => now;
    l.command({
      v: PROTOCOL_VERSION,
      type: 'teacher.demo.start',
      mode: 'fullscreen',
      source: 'teacher',
    });
    const host = source();
    l.relay.attachSource(l.sessionId, 'teacher', host);
    const [fast, slow] = l.students;
    if (!fast || !slow) throw new Error('no students');
    l.relay.frame(l.sessionId, host, frame(true, 1));

    slow.sock.bufferedAmount = 5 * 1024 * 1024;
    now += 2000;
    l.relay.frame(l.sessionId, host, frame(false, 2));
    expect(slow.sock.frames).toHaveLength(1);
    expect(host.said).toEqual(['keyframe', 'keyframe']);

    // Caught up, but a change is no use without the picture it changes: still waiting.
    slow.sock.bufferedAmount = 0;
    now += 200;
    l.relay.frame(l.sessionId, host, frame(false, 3));
    expect(slow.sock.frames).toHaveLength(1);
    // Asked at most once a second.
    expect(host.said).toHaveLength(2);
    now += 200;
    l.relay.frame(l.sessionId, host, frame(true, 4));
    expect(slow.sock.frames).toHaveLength(2);
    expect(fast.sock.frames).toHaveLength(4);
  });

  it('starts a newcomer with a whole picture', async () => {
    let now = 1_000_000;
    const l = await lesson();
    (l.relay as unknown as { now: () => number }).now = () => now;
    l.command({
      v: PROTOCOL_VERSION,
      type: 'teacher.demo.start',
      mode: 'fullscreen',
      source: 'teacher',
    });
    const host = source();
    l.relay.attachSource(l.sessionId, 'teacher', host);
    l.relay.frame(l.sessionId, host, frame(true, 1));
    now += 2000;
    const late = socket();
    l.store.attach(l.sessionId, late, 'projector', null);
    expect(host.said).toEqual(['keyframe', 'keyframe']);
    now += 200;
    l.relay.frame(l.sessionId, host, frame(false, 2));
    expect(late.frames).toHaveLength(0);
    now += 200;
    l.relay.frame(l.sessionId, host, frame(true, 3));
    expect(late.frames).toHaveLength(1);
  });
});

describe('/ws/demo over a real socket', () => {
  it('takes the teacher’s app by its token, only during a broadcast, and nobody else', async () => {
    const { default: WebSocket } = await import('ws');
    const database = testDatabase();
    const app = await buildApp({
      config: testConfig({ CLASSROOM_MODE: '1', HOST_TOKEN: 'host-token-of-this-computer' }),
      db: database.db,
      content: testContent(),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    opened.push({ app, close: () => database.close() });
    const port = (app.server.address() as { port: number }).port;
    const cookie = await loginTeacher(app);
    const sessionId = SessionResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: { cookie },
          payload: { classId: 'class-1a', lessonId: 'k10' },
        })
      ).json(),
    ).session.id;

    /** Connects and reports how it ended: the first text heard, or the close code. */
    const connect = (token: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/demo?session=${sessionId}`, {
          headers: { 'x-host-token': token },
        });
        ws.on('message', (data: Buffer) => {
          resolve(`said ${data.toString('utf8')}`);
          ws.close();
        });
        ws.on('close', (code) => resolve(`closed ${code}`));
      });

    expect(await connect('host-token-of-this-computer')).toBe('closed 4001');
    const teacher = socket();
    app.sessions.attach(sessionId, teacher, 'teacher', null);
    app.sessions.dispatch(sessionId, teacher, {
      kind: 'command',
      role: 'teacher',
      participantId: null,
      message: {
        v: PROTOCOL_VERSION,
        type: 'teacher.demo.start',
        mode: 'fullscreen',
        source: 'teacher',
      },
      now: Date.now(),
    });
    expect(await connect('a-guess-of-the-token')).toBe('closed 4001');
    expect(await connect('host-token-of-this-computer')).toBe('said keyframe');
  });
});
