import { afterEach, describe, expect, it } from 'vitest';
import {
  type ClientMessage,
  JoinResponseSchema,
  PROTOCOL_VERSION,
  SessionResponseSchema,
  type ServerMessage,
} from '@sinf/shared';
import { buildApp } from '../src/app.js';
import type { RoomSocket } from '../src/realtime/session-store.js';
import { loginTeacher, testConfig, testContent, testDatabase } from './helpers.js';

/**
 * H11 (PLAN.md 7.1): one lesson with a whole computer class of 30. The room must reach every child
 * with every change, and stay fast while thirty children send thumbnails. The full run over real
 * sockets, with latencies, is `tools/load/classroom.cjs`; this keeps the shape of it under test.
 */

const CLASS_SIZE = 30;

type App = Awaited<ReturnType<typeof buildApp>>;
const opened: { app: App; close: () => void }[] = [];

afterEach(async () => {
  for (const { app, close } of opened.splice(0)) {
    for (const id of app.sessions.liveSessionIds()) app.sessions.end(id);
    await app.close();
    close();
  }
});

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

describe('a class of 30 on one lesson', () => {
  it('reaches every child with every slide and quiz step, quickly, under a thumbnail flood', async () => {
    const database = testDatabase();
    const app = await buildApp({
      config: testConfig({ CLASSROOM_MODE: '1' }),
      db: database.db,
      content: testContent(),
    });
    await app.ready();
    opened.push({ app, close: () => database.close() });
    const cookie = await loginTeacher(app);

    // A grade-5 class of thirty: digit codes, as in a real computer class.
    const created = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: { cookie },
      payload: { name: '5Б', grade: 5 },
    });
    const classId = created.json<{ class: { id: string } }>().class.id;
    await app.inject({
      method: 'POST',
      url: `/api/classes/${classId}/students`,
      headers: { cookie },
      payload: {
        students: Array.from({ length: CLASS_SIZE }, (_, i) => ({
          lastName: `Ученик${String(i + 1).padStart(2, '0')}`,
          firstName: 'Тест',
        })),
      },
    });
    const details = (
      await app.inject({ method: 'GET', url: `/api/classes/${classId}`, headers: { cookie } })
    ).json<{ students: { id: string; code: string[] }[] }>();
    expect(details.students).toHaveLength(CLASS_SIZE);

    const sessionId = SessionResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: { cookie },
          payload: { classId, lessonId: 'g10' },
        })
      ).json(),
    ).session.id;

    const store = app.sessions;
    const children = await Promise.all(
      details.students.map(async (s, i) => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/join',
          payload: { sessionId, studentId: s.id, code: s.code, pc: `ПК-${i + 1}` },
        });
        const { token, participantId } = JoinResponseSchema.parse(res.json());
        const sock = socket();
        store.attach(sessionId, sock, 'student', token);
        return { sock, participantId };
      }),
    );
    const teacher = socket();
    store.attach(sessionId, teacher, 'teacher', null);
    expect(store.getState(sessionId)?.participants).toSatisfy(
      (p: object) => Object.keys(p).length === CLASS_SIZE,
    );

    const command = (message: ClientMessage) =>
      store.dispatch(sessionId, teacher, {
        kind: 'command',
        role: 'teacher',
        participantId: null,
        message,
        now: Date.now(),
      });
    const thumb = 'A'.repeat(40_000);

    const started = performance.now();
    for (let round = 1; round <= 20; round += 1) {
      // Every child sends a thumbnail, then the teacher turns the slide.
      for (const c of children) {
        store.dispatch(sessionId, c.sock, {
          kind: 'command',
          role: 'student',
          participantId: c.participantId,
          message: { v: PROTOCOL_VERSION, type: 'student.thumb', jpeg: thumb },
          now: Date.now(),
        });
      }
      command({ v: PROTOCOL_VERSION, type: 'teacher.screen.set', index: round % 10 });
    }
    command({ v: PROTOCOL_VERSION, type: 'teacher.quiz.start' });
    const elapsed = performance.now() - started;

    for (const c of children) {
      const slides = c.sock.got.filter((m) => m.type === 'screen.changed');
      expect(slides).toHaveLength(20);
      expect(
        c.sock.got.some((m) => m.type === 'quiz.changed' && m.quiz?.phase === 'question'),
      ).toBe(true);
      // A child never gets anybody's thumbnail.
      expect(c.sock.got.some((m) => m.type === 'thumb')).toBe(false);
    }
    // Thumbnails reach the teacher at most one per child in the interval: here, once each.
    expect(teacher.got.filter((m) => m.type === 'thumb')).toHaveLength(CLASS_SIZE);
    // 20 rounds of 30 thumbnails and a slide, and a quiz: well under a second on any machine
    // that runs the tests; the classroom budget is 300 ms per change on a weak one.
    expect(elapsed).toBeLessThan(2000);
  });
});
