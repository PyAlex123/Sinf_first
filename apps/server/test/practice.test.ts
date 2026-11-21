import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JoinResponseSchema,
  LessonSyncBundleSchema,
  PracticeResponseSchema,
  SessionResponseSchema,
  SessionResultsSchema,
  StudentFilesResponseSchema,
  type ServerMessage,
} from '@sinf/shared';
import type { RoomSocket } from '../src/realtime/session-store.js';
import { FILES_AFTER_END_MS } from '../src/realtime/session-store.js';
import { HAND_IN_GRACE_MS } from '../src/services/practice.js';
import { buildLessonBundle } from '../src/sync/outbox.js';
import { REPO_ROOT } from '../src/config.js';
import { schema } from '../src/db/index.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** H16: the practice of a lesson in a real program, checked on the lesson server (ADR-016). */

const LESSON = 'proba-dokument';
const FILE = 'Оформи документ.docx';
const fixture = (name: string): Buffer =>
  readFileSync(join(REPO_ROOT, 'apps/server/test/fixtures/practice', name));
const TEMPLATE = readFileSync(
  join(REPO_ROOT, 'content/proba-praktiki/templates/oformi-dokument.docx'),
);
const DONE = fixture('oformi-dokument-done.docx');
const HALF = fixture('oformi-dokument-half.docx');

let t: TestApp;
let cookie: string;
let sessionId: string;

beforeEach(async () => {
  t = await testApp({ CLASSROOM_MODE: '1' });
  cookie = await loginTeacher(t.app);
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { classId: 'class-1a', lessonId: LESSON },
  });
  if (created.statusCode !== 200) throw new Error(created.body);
  sessionId = SessionResponseSchema.parse(created.json()).session.id;
});

afterEach(async () => {
  vi.useRealTimers();
  for (const id of t.app.sessions.liveSessionIds()) t.app.sessions.end(id);
  await t.close();
});

async function enter(studentId: string): Promise<Record<string, string>> {
  const student = t.database.db
    .select()
    .from(schema.students)
    .all()
    .find((s) => s.id === studentId);
  if (!student) throw new Error('no student');
  const joined = await t.app.inject({
    method: 'POST',
    url: '/api/join',
    payload: { sessionId, studentId, code: student.codePublic.split('+') },
  });
  if (joined.statusCode !== 200) throw new Error(joined.body);
  const { token } = JoinResponseSchema.parse(joined.json());
  return { 'x-session-id': sessionId, 'x-participant-token': token };
}

function put(headers: Record<string, string>, name: string, bytes: Buffer, base?: string) {
  const q = new URLSearchParams({ name, ...(base ? { base } : {}) });
  return t.app.inject({
    method: 'PUT',
    url: `/api/my/files?${q.toString()}`,
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
}

/** A save of the practice's file as the classroom app makes it: over the version it came from. */
async function save(headers: Record<string, string>, bytes: Buffer, name = FILE) {
  const there = (await files(headers)).find((f) => f.name === name);
  return put(headers, name, bytes, there?.sha256 ?? undefined);
}

const files = async (headers: Record<string, string>) =>
  StudentFilesResponseSchema.parse(
    (await t.app.inject({ method: 'GET', url: '/api/my/files', headers })).json(),
  ).files;

const results = async () =>
  SessionResultsSchema.parse(
    (
      await t.app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/results`,
        headers: { cookie },
      })
    ).json(),
  );

const rowOf = async (studentId: string) => {
  const row = (await results()).rows.find((r) => r.studentId === studentId);
  if (!row) throw new Error('no row');
  return row;
};

function socket(): RoomSocket & { got: ServerMessage[] } {
  const got: ServerMessage[] = [];
  return {
    got,
    readyState: 1,
    OPEN: 1,
    send: (data: string | Uint8Array) => {
      if (typeof data === 'string') got.push(JSON.parse(data) as ServerMessage);
    },
    close: () => undefined,
    ping: () => undefined,
    terminate: () => undefined,
  };
}

/** The teacher moves the lesson to another stage, as the panel does. */
function stage(index: number): void {
  const teacher = socket();
  t.app.sessions.attach(sessionId, teacher, 'teacher', null);
  t.app.sessions.dispatch(sessionId, teacher, {
    kind: 'command',
    role: 'teacher',
    participantId: null,
    message: { v: 1, type: 'teacher.stage.set', index },
    now: Date.now(),
  });
}

describe('the practice task of a lesson', () => {
  it('is given to the page, and a lesson without one says so', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/lessons/${LESSON}/practice` });
    const { practice } = PracticeResponseSchema.parse(res.json());
    expect(practice?.fileName).toBe(FILE);
    expect(practice?.criteria.map((c) => c.kind)).toEqual([
      'auto',
      'auto',
      'auto',
      'auto',
      'auto',
      'manual',
      'manual',
    ]);
    const none = await t.app.inject({ method: 'GET', url: '/api/lessons/g10/practice' });
    expect(PracticeResponseSchema.parse(none.json()).practice).toBeNull();
  });
});

describe('the template', () => {
  it('is in the child’s folder after login, and a file already there stays theirs', async () => {
    const child = await enter('student-01');
    const first = await files(child);
    expect(first.map((f) => [f.name, f.origin, f.size])).toEqual([
      [FILE, 'задание', TEMPLATE.length],
    ]);

    // The child works on it; logging in again does not bring the empty template back.
    expect((await save(child, HALF)).statusCode).toBe(200);
    const again = await enter('student-01');
    const second = await files(again);
    expect(second).toHaveLength(1);
    expect(second[0]?.size).toBe(HALF.length);
  });
});

describe('a save during the lesson', () => {
  it('is checked: the tile, the child’s check-list and the results follow', async () => {
    const child = await enter('student-01');
    expect(t.app.sessions.getState(sessionId)?.participants['student-01']?.check).toBeNull();

    await save(child, HALF);
    const check = t.app.sessions.getState(sessionId)?.participants['student-01']?.check;
    expect(check).toMatchObject({ fileName: FILE, file: 'ok', passed: 3, total: 5 });
    expect(check?.outcomes).toMatchObject({ title: 'pass', list: 'fail', table: 'fail' });

    // A renamed copy is the practice's file too: what counts is the kind of file.
    await put(child, 'Мой документ.docx', DONE);
    expect(t.app.sessions.getState(sessionId)?.participants['student-01']?.check).toMatchObject({
      fileName: 'Мой документ.docx',
      passed: 5,
    });

    // A picture is not the practice's file: nothing changes.
    await put(child, 'Рисунок.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(t.app.sessions.getState(sessionId)?.participants['student-01']?.check?.passed).toBe(5);

    // 10 of 14 points: the two manual criteria are the teacher's.
    const row = await rowOf('student-01');
    expect(row.check).toMatchObject({ points: 10, max: 14, submitted: false, file: 'ok' });
    expect(row.check?.outcomes).toMatchObject({ title: 'pass', spelling: 'unknown' });
    expect(row.check?.found['font-14']).toContain('14 пт');
    expect((await results()).maxima.check).toBe(14);
    expect(row.percent).toBe(71);
  });

  it('from the child’s home is not checked: no lesson, no score', async () => {
    const child = await enter('student-01');
    // The same child, but the request carries a lesson id without its token.
    await put({ 'x-session-id': sessionId, 'x-participant-token': 'nope' }, FILE, DONE).catch(
      () => undefined,
    );
    await put(child, 'Рисунок.png', Buffer.from([1, 2, 3]));
    expect(t.app.sessions.getState(sessionId)?.participants['student-01']?.check).toBeNull();
  });

  it('a broken file never gives a 2: the teacher looks', async () => {
    const child = await enter('student-01');
    await save(child, Buffer.from('not a zip at all'));
    const check = t.app.sessions.getState(sessionId)?.participants['student-01']?.check;
    expect(check?.file).toBe('unreadable');
    expect(Object.values(check?.outcomes ?? {})).toEqual(Array(5).fill('unknown'));
  });
});

describe('the teacher’s marks', () => {
  it('count the manual criteria and decide what the checker could not', async () => {
    const child = await enter('student-01');
    await save(child, DONE);
    const mark = (marks: Record<string, boolean | null>, studentId = 'student-01') =>
      t.app.inject({
        method: 'PUT',
        url: `/api/sessions/${sessionId}/practice-marks`,
        headers: { cookie },
        payload: { studentId, marks },
      });

    let res = await mark({ spelling: true, neat: true });
    expect(res.statusCode).toBe(200);
    let row = SessionResultsSchema.parse(res.json()).rows.find((r) => r.studentId === 'student-01');
    expect(row?.check).toMatchObject({
      points: 14,
      max: 14,
      marks: { spelling: true, neat: true },
    });
    expect(row?.percent).toBe(100);

    // The teacher's word beats the checker's; null gives the criterion back.
    res = await mark({ table: false, neat: null });
    row = SessionResultsSchema.parse(res.json()).rows.find((r) => r.studentId === 'student-01');
    expect(row?.check?.outcomes).toMatchObject({ table: 'fail', neat: 'unknown' });
    expect(row?.check?.points).toBe(10);

    expect((await mark({ nonsense: true })).statusCode).toBe(400);
    // A child who did not come cannot be marked.
    expect((await mark({ spelling: true }, 'student-02')).statusCode).toBe(400);

    // A child who saved nothing can still be marked: a row without a file.
    await enter('student-03');
    res = await mark({ spelling: true }, 'student-03');
    row = SessionResultsSchema.parse(res.json()).rows.find((r) => r.studentId === 'student-03');
    expect(row?.check).toMatchObject({ fileName: null, points: 2 });
  });
});

describe('handing in (CLAUDE.md §4.8)', () => {
  it('freezes the version at the end of the practice; a late "save?" still counts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const child = await enter('student-01');
    stage(2); // the practice
    await save(child, HALF);
    stage(3); // leaving it: photographs of the class, and the works are handed in

    let row = await rowOf('student-01');
    expect(row.check).toMatchObject({ submitted: true, points: 6 });

    // The program asked "save?" as the practice closed it: a few seconds later still counts.
    vi.setSystemTime(Date.now() + 5_000);
    await save(child, DONE);
    row = await rowOf('student-01');
    expect(row.check).toMatchObject({ submitted: true, points: 10 });

    // Later the work no longer changes what was handed in.
    vi.setSystemTime(Date.now() + HAND_IN_GRACE_MS + 1_000);
    await save(child, HALF);
    row = await rowOf('student-01');
    expect(row.check).toMatchObject({ submitted: true, points: 10 });

    // The teacher downloads the version handed in.
    const got = await t.app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/practice/student-01/file`,
      headers: { cookie },
    });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(DONE)).toBe(true);
    expect(got.headers['content-disposition']).toContain('attachment');
    expect(got.headers['content-security-policy']).toBe('sandbox');
  });

  it('keeps the bytes handed in after the child changes the file, and they travel up', async () => {
    const child = await enter('student-01');
    await save(child, DONE);
    t.app.sessions.end(sessionId); // a lesson ended without leaving the practice: handed in now

    const bundle = LessonSyncBundleSchema.parse(buildLessonBundle(t.database.db, sessionId));
    expect(bundle.checks).toHaveLength(1);
    expect(bundle.checks?.[0]).toMatchObject({ studentId: 'student-01', fileName: FILE });
    expect(bundle.checks?.[0]?.report?.autoScore).toBe(10);
    expect(bundle.checks?.[0]?.submittedAt).not.toBeNull();

    // At home the child overwrites the file; the version handed in is still on the disk.
    const folder = await files(child);
    expect(folder.find((f) => f.name === FILE)?.size).toBe(DONE.length);
    const got = await t.app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/practice/student-01/file`,
      headers: { cookie },
    });
    expect(got.rawPayload.equals(DONE)).toBe(true);
  });

  it('lets the classroom app send the last save for a short while after the end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const child = await enter('student-01');
    t.app.sessions.end(sessionId);
    expect((await put(child, 'Итог.txt', Buffer.from('готово'))).statusCode).toBe(200);
    vi.setSystemTime(Date.now() + FILES_AFTER_END_MS + 1_000);
    expect((await put(child, 'Итог2.txt', Buffer.from('поздно'))).statusCode).toBe(401);
  });
});
