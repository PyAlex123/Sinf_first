import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DeviceSchema,
  LessonSyncResponseSchema,
  PairDeviceResponseSchema,
  SchoolSnapshotSchema,
  type LessonSyncBundle,
} from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/**
 * The platform's half of S2.6: it hands a paired school computer the roster of its school and takes
 * back what the lessons produced. The rule that matters most here is that taking the same lesson
 * twice changes nothing.
 */

let t: TestApp;
let cookie: string;
let token: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
  token = await pairedDevice();
});

afterEach(async () => {
  await t.close();
});

/** Adds a computer to the demo school and pairs it, the way the app does (S2.4). */
async function pairedDevice(): Promise<string> {
  const created = await t.app.inject({
    method: 'POST',
    url: `/api/schools/${DEMO.schoolId}/devices`,
    headers: { cookie },
    payload: { name: 'ПК-05' },
  });
  const device = z.strictObject({ device: DeviceSchema }).parse(created.json()).device;
  const paired = await t.app.inject({
    method: 'POST',
    url: '/api/devices/pair',
    payload: { code: device.pairingCode, appVersion: '0.1.0' },
  });
  return PairDeviceResponseSchema.parse(paired.json()).deviceToken;
}

const snapshot = (headers: Record<string, string> = { authorization: `Device ${token}` }) =>
  t.app.inject({ method: 'GET', url: '/api/sync/snapshot', headers });

const send = (bundle: LessonSyncBundle, auth = `Device ${token}`) =>
  t.app.inject({
    method: 'POST',
    url: '/api/sync/lesson',
    headers: { authorization: auth },
    payload: bundle,
  });

/** A lesson as a school computer would describe it after it ended. */
function bundle(overrides: Partial<LessonSyncBundle['session']> = {}): LessonSyncBundle {
  const startedAt = new Date('2026-11-18T08:00:00.000Z').toISOString();
  return {
    session: {
      id: randomUUID(),
      classId: DEMO.classId,
      lessonId: 'g10',
      teacherId: DEMO.teacherId,
      startedAt,
      endedAt: new Date('2026-11-18T08:45:00.000Z').toISOString(),
      status: 'ended',
      ...overrides,
    },
    attendance: [
      { studentId: 'student-01', status: 'present', joinedAt: startedAt },
      { studentId: 'student-02', status: 'absent', joinedAt: null },
    ],
    screenResults: [
      {
        studentId: 'student-01',
        screenIndex: 3,
        stars: 2,
        attempts: 1,
        firstAt: startedAt,
        lastAt: startedAt,
      },
    ],
    practiceResults: [{ studentId: 'student-01', stars: 3, stepsDone: 16, at: startedAt }],
    quizAttempts: [],
  };
}

describe('the roster of a school', () => {
  it('is given only to a paired computer', async () => {
    expect((await snapshot({})).statusCode).toBe(401);
    expect((await snapshot({ cookie })).statusCode).toBe(401);
    expect((await snapshot({ authorization: 'Device nonsense' })).statusCode).toBe(401);
    expect((await snapshot()).statusCode).toBe(200);
  });

  it('holds the school, its teachers, classes and students', async () => {
    const body = SchoolSnapshotSchema.parse((await snapshot()).json());
    expect(body.school.id).toBe(DEMO.schoolId);
    expect(body.teachers.map((x) => x.email)).toContain(DEMO.teacherEmail);
    expect(body.classes.map((c) => c.id)).toEqual([DEMO.classId]);
    expect(body.students).toHaveLength(20);
    const first = body.students[0];
    expect(first?.classId).toBe(DEMO.classId);
    // The child logs in by code with no internet, so the code travels with them.
    expect(first?.codeHash.length).toBeGreaterThan(10);
  });

  it('never carries a teacher password hash', async () => {
    const text = (await snapshot()).body;
    expect(text).not.toContain('passwordHash');
    // The demo teacher's own hash, to be sure the check is not just about the field name.
    const user = t.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, DEMO.teacherId))
      .get();
    expect(user?.passwordHash).toBeTruthy();
    expect(text).not.toContain(user?.passwordHash ?? 'nothing');
  });

  it('keeps its version while nothing changes and moves when something does', async () => {
    const first = SchoolSnapshotSchema.parse((await snapshot()).json()).version;
    expect(SchoolSnapshotSchema.parse((await snapshot()).json()).version).toBe(first);

    await t.app.inject({
      method: 'PATCH',
      url: '/api/students/student-01',
      headers: { cookie },
      payload: { lastName: 'Алиева', firstName: 'Тимура' },
    });
    expect(SchoolSnapshotSchema.parse((await snapshot()).json()).version).not.toBe(first);
  });
});

describe('a lesson arriving from a school computer', () => {
  const rows = (sessionId: string) => ({
    attendance: t.database.db
      .select()
      .from(schema.attendance)
      .where(eq(schema.attendance.sessionId, sessionId))
      .all().length,
    screens: t.database.db
      .select()
      .from(schema.screenResults)
      .where(eq(schema.screenResults.sessionId, sessionId))
      .all().length,
  });

  it('is written as the school sent it', async () => {
    const payload = bundle();
    const res = await send(payload);
    expect(res.statusCode).toBe(200);
    expect(LessonSyncResponseSchema.parse(res.json()).counts).toEqual({
      attendance: 2,
      screenResults: 1,
      practiceResults: 1,
      quizAttempts: 0,
    });
    expect(rows(payload.session.id)).toEqual({ attendance: 2, screens: 1 });
    const stored = t.database.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, payload.session.id))
      .get();
    expect(stored?.status).toBe('ended');
    expect(stored?.syncedAt).toBeTruthy();
  });

  it('changes nothing when the same lesson is sent again', async () => {
    const payload = bundle();
    await send(payload);
    const after = rows(payload.session.id);
    expect((await send(payload)).statusCode).toBe(200);
    expect((await send(payload)).statusCode).toBe(200);
    expect(rows(payload.session.id)).toEqual(after);
    expect(
      t.database.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, payload.session.id))
        .all(),
    ).toHaveLength(1);
  });

  it('keeps the better result when a later send carries more of the same lesson', async () => {
    const payload = bundle();
    await send(payload);
    const better = structuredClone(payload);
    const screen = better.screenResults[0];
    if (!screen) throw new Error('no screen result');
    screen.stars = 3;
    screen.attempts = 2;
    await send(better);
    const stored = t.database.db
      .select()
      .from(schema.screenResults)
      .where(eq(schema.screenResults.sessionId, payload.session.id))
      .get();
    expect(stored?.stars).toBe(3);

    // And a send that went backwards does not take the stars away.
    await send(payload);
    expect(
      t.database.db
        .select()
        .from(schema.screenResults)
        .where(eq(schema.screenResults.sessionId, payload.session.id))
        .get()?.stars,
    ).toBe(3);
  });

  it('refuses a class that is not of this school, a stranger student and an outside teacher', async () => {
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: { cookie },
      payload: { name: 'Личный 5Б', grade: 5 },
    });
    // A personal class of the same teacher belongs to no school, so the device may not write to it.
    const personalId = z
      .strictObject({ class: z.looseObject({ id: z.string() }) })
      .parse(other.json()).class.id;
    expect((await send(bundle({ classId: personalId }))).statusCode).toBe(404);

    const strangerStudent = bundle();
    strangerStudent.attendance = [
      { studentId: 'student-01', status: 'present', joinedAt: null },
      { studentId: 'no-such-student', status: 'present', joinedAt: null },
    ];
    expect((await send(strangerStudent)).statusCode).toBe(404);

    expect((await send(bundle({ teacherId: 'user-nobody' }))).statusCode).toBe(404);
    expect((await send(bundle(), 'Device nonsense')).statusCode).toBe(401);
  });

  it('refuses to move a lesson to another class under the same id', async () => {
    const payload = bundle();
    await send(payload);
    const moved = bundle({ id: payload.session.id, classId: 'class-1a' });
    expect((await send(moved)).statusCode).toBe(200);

    const created = await t.app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: { cookie },
      payload: { name: '2А', grade: 2, schoolId: DEMO.schoolId },
    });
    const secondClass = z
      .strictObject({ class: z.looseObject({ id: z.string() }) })
      .parse(created.json()).class.id;
    const hijack = bundle({ id: payload.session.id, classId: secondClass });
    hijack.attendance = [];
    hijack.screenResults = [];
    hijack.practiceResults = [];
    expect((await send(hijack)).statusCode).toBe(409);
  });
});

describe('the sync status', () => {
  it('says this server is the platform and has nothing to send', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/sync/status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'platform', pending: 0 });
  });

  it('is not public', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/sync/status' })).statusCode).toBe(401);
  });
});
