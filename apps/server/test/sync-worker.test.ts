import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DeviceSchema,
  JoinResponseSchema,
  PairDeviceResponseSchema,
  SessionResponseSchema,
  SessionResultsSchema,
  SyncStatusSchema,
} from '@sinf/shared';
import { buildApp } from '../src/app.js';
import { openDatabase, schema, type DatabaseHandle } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { DEMO } from '../src/db/seed.js';
import { SyncWorker } from '../src/sync/worker.js';
import { loginTeacher, testConfig, testContent, testApp, type TestApp } from './helpers.js';

/**
 * The school computer's half of S2.6, end to end: a lesson is held on a computer of its own, with
 * its own database and no connection, and afterwards it turns up on the platform exactly once.
 *
 * Two servers really talk to each other here; only the wire is short-circuited, so the status codes,
 * the headers and the schemas are the real ones.
 */

let cloud: TestApp;
let cloudCookie: string;
let school: FastifyInstance;
let schoolDb: DatabaseHandle;
let worker: SyncWorker;
let schoolDataDir: string;
/** The classroom's internet. Flip it to see what the lesson does without one. */
let online = true;

/** Sends a request of the school computer into the platform app instead of over the network. */
function fetchTo(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    if (!online) throw new TypeError('fetch failed');
    const url = new URL(typeof input === 'string' ? input : (input as URL).toString());
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: url.pathname + url.search,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    return new Response(res.body, {
      status: res.statusCode,
      headers: { 'content-type': res.headers['content-type']?.toString() ?? 'application/json' },
    });
  };
}

async function pairedDevice(): Promise<string> {
  const created = await cloud.app.inject({
    method: 'POST',
    url: `/api/schools/${DEMO.schoolId}/devices`,
    headers: { cookie: cloudCookie },
    payload: { name: 'ПК-05', room: 'Кабинет 204' },
  });
  const device = z.strictObject({ device: DeviceSchema }).parse(created.json()).device;
  const paired = await cloud.app.inject({
    method: 'POST',
    url: '/api/devices/pair',
    payload: { code: device.pairingCode, appVersion: '0.2.0' },
  });
  return PairDeviceResponseSchema.parse(paired.json()).deviceToken;
}

beforeEach(async () => {
  online = true;
  cloud = await testApp();
  cloudCookie = await loginTeacher(cloud.app);
  const token = await pairedDevice();

  // The school computer: its own empty database, pointed at the platform.
  schoolDb = openDatabase(':memory:');
  runMigrations(schoolDb.db);
  const config = testConfig({ PLATFORM_URL: 'http://platform.test', DEVICE_TOKEN: token });
  schoolDataDir = config.dataDir;
  const toCloud = fetchTo(cloud.app);
  worker = new SyncWorker(schoolDb.db, config, console as never, {
    fetchImpl: toCloud,
    // The test drives the ticks itself.
    pushEveryMs: 3_600_000,
    pullEveryMs: 3_600_000,
  });
  school = await buildApp(
    { config, db: schoolDb.db, content: testContent() },
    { sync: worker, platformFetch: toCloud },
  );
  await school.ready();
});

afterEach(async () => {
  worker.stop();
  await school.close();
  schoolDb.close();
  await cloud.close();
});

const schoolStudents = () => schoolDb.db.select().from(schema.students).all();

describe('the roster coming down', () => {
  it('brings the school, its class and its children onto this computer', async () => {
    await worker.pull();
    const classes = schoolDb.db.select().from(schema.classes).all();
    expect(classes.map((c) => c.id)).toEqual([DEMO.classId]);
    expect(classes[0]?.schoolId).toBe(DEMO.schoolId);
    expect(schoolStudents()).toHaveLength(20);
    // The identifiers are the platform's own, which is what lets the results go back.
    expect(schoolStudents().map((s) => s.id)).toContain('student-01');
  });

  it('does not rewrite a roster that has not changed', async () => {
    await worker.pull();
    schoolDb.db
      .update(schema.students)
      .set({ firstName: 'Не трогать' })
      .where(eq(schema.students.id, 'student-01'))
      .run();
    await worker.pull();
    expect(
      schoolDb.db.select().from(schema.students).where(eq(schema.students.id, 'student-01')).get()
        ?.firstName,
    ).toBe('Не трогать');
  });

  it('rewrites it once the school changed something', async () => {
    await worker.pull();
    await cloud.app.inject({
      method: 'PATCH',
      url: '/api/students/student-01',
      headers: { cookie: cloudCookie },
      payload: { lastName: 'Алиев', firstName: 'Тимурбек' },
    });
    await worker.pull();
    expect(
      schoolDb.db.select().from(schema.students).where(eq(schema.students.id, 'student-01')).get()
        ?.firstName,
    ).toBe('Тимурбек');
  });

  it('keeps a child the school removed, but stops offering them', async () => {
    await worker.pull();
    await cloud.app.inject({
      method: 'DELETE',
      url: '/api/students/student-20',
      headers: { cookie: cloudCookie },
    });
    await worker.pull();
    const gone = schoolDb.db
      .select()
      .from(schema.students)
      .where(eq(schema.students.id, 'student-20'))
      .get();
    expect(gone).toBeTruthy();
    expect(gone?.isActive).toBe(false);
  });

  it('says nothing and breaks nothing when there is no internet', async () => {
    online = false;
    await expect(worker.pull()).resolves.toBeNull();
    expect(schoolStudents()).toHaveLength(0);
    expect(worker.status().lastError).toBeTruthy();
  });
});

describe('a teacher logging in on a school computer', () => {
  const login = (password: string) =>
    school.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      payload: { email: DEMO.teacherEmail, password },
    });

  it('is checked on the platform the first time and remembered for later', async () => {
    await worker.pull();
    // The roster carries no password hash, so nothing here can match until the platform says so.
    expect(
      schoolDb.db.select().from(schema.users).where(eq(schema.users.id, DEMO.teacherId)).get()
        ?.passwordHash,
    ).toBe('platform-only');

    expect((await login('demo1234')).statusCode).toBe(200);

    // From now on the lesson starts with the cable unplugged.
    online = false;
    expect((await login('demo1234')).statusCode).toBe(200);
    expect((await login('wrong-password')).statusCode).toBe(401);
  });

  it('does not let in someone this school does not know', async () => {
    await worker.pull();
    const res = await school.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      payload: { email: 'stranger@example.com', password: 'demo1234' },
    });
    expect(res.statusCode).toBe(401);
  });
});

/** Logs the mirrored teacher in on the school computer. The first time this needs the platform. */
async function teacherCookie(): Promise<string> {
  const res = await school.inject({
    method: 'POST',
    url: '/api/auth/teacher',
    payload: { email: DEMO.teacherEmail, password: 'demo1234' },
  });
  const c = res.cookies.find((x) => x.name === 'sinf_teacher');
  if (!c) throw new Error(`no cookie: ${res.statusCode} ${res.body}`);
  return `${c.name}=${c.value}`;
}

describe('results going up', () => {
  /** Holds a lesson on the school computer: a child joins, earns stars, the teacher ends it. */
  async function holdALesson(cookie: string): Promise<string> {
    const created = await school.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: DEMO.classId, lessonId: 'g10' },
    });
    const { session } = SessionResponseSchema.parse(created.json());

    const student = schoolDb.db
      .select()
      .from(schema.students)
      .where(eq(schema.students.id, 'student-01'))
      .get();
    if (!student) throw new Error('no student');
    const joined = await school.inject({
      method: 'POST',
      url: '/api/join',
      payload: {
        sessionId: session.id,
        studentId: student.id,
        code: student.codePublic.split('+'),
      },
    });
    JoinResponseSchema.parse(joined.json());

    // Stars arrive over the websocket during the lesson (covered by realtime.test.ts); here the row
    // is what matters, so it is written the way the lesson writes it.
    schoolDb.db
      .insert(schema.screenResults)
      .values({
        sessionId: session.id,
        studentId: student.id,
        screenIndex: 5,
        stars: 3,
        attempts: 1,
        firstAt: new Date().toISOString(),
        lastAt: new Date().toISOString(),
      })
      .run();

    await school.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/end`,
      headers: { cookie },
    });
    return session.id;
  }

  it('waits through a lesson without internet and then lands in the cloud exactly once', async () => {
    await worker.pull();
    // The teacher signed in in the morning, while the school still had a connection.
    const cookie = await teacherCookie();
    online = false;
    const sessionId = await holdALesson(cookie);

    // Nothing reached the platform, and the lesson itself is untouched here.
    expect(cloud.database.db.select().from(schema.sessions).all()).toHaveLength(0);
    expect(worker.status().pending).toBe(1);

    online = true;
    expect(await worker.push()).toBe(1);

    const stored = cloud.database.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    expect(stored?.status).toBe('ended');
    expect(stored?.classId).toBe(DEMO.classId);
    const attendance = cloud.database.db
      .select()
      .from(schema.attendance)
      .where(eq(schema.attendance.sessionId, sessionId))
      .all();
    // One child was there, the rest of the class was marked absent when the lesson ended.
    expect(attendance).toHaveLength(20);
    expect(attendance.filter((a) => a.status === 'present')).toHaveLength(1);
    const stars = cloud.database.db
      .select()
      .from(schema.screenResults)
      .where(eq(schema.screenResults.sessionId, sessionId))
      .get();
    expect(stars?.stars).toBe(3);

    // Sending again adds nothing: there is nothing left to send.
    expect(await worker.push()).toBe(0);
    expect(worker.status().pending).toBe(0);
    expect(
      cloud.database.db
        .select()
        .from(schema.attendance)
        .where(eq(schema.attendance.sessionId, sessionId))
        .all(),
    ).toHaveLength(20);
  });

  it('tells the teacher what is waiting', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    online = false;
    await holdALesson(cookie);

    const waiting = SyncStatusSchema.parse(
      (await school.inject({ method: 'GET', url: '/api/sync/status', headers: { cookie } })).json(),
    );
    expect(waiting).toMatchObject({ mode: 'school', pending: 1 });

    online = true;
    const sent = SyncStatusSchema.parse(
      (await school.inject({ method: 'POST', url: '/api/sync/now', headers: { cookie } })).json(),
    );
    expect(sent.pending).toBe(0);
    expect(sent.lastSyncAt).toBeTruthy();
    expect(sent.lastError).toBeNull();
  });

  it('holds an unfinished lesson back until it ends', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    await school.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: DEMO.classId, lessonId: 'g10' },
    });
    expect(worker.status().pending).toBe(0);
    expect(await worker.push()).toBe(0);
  });
  /** A photograph of the child's screen, the way the classroom app leaves it on this computer (H5). */
  function leaveAScreenshot(sessionId: string, id: string, bytes: Buffer): void {
    const fileKey = `screenshots/${sessionId}/${id}.jpg`;
    const path = join(schoolDataDir, fileKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    schoolDb.db
      .insert(schema.screenshots)
      .values({
        id,
        sessionId,
        studentId: 'student-01',
        kind: 'stage_end',
        takenAt: new Date().toISOString(),
        fileKey,
        width: 1366,
        height: 768,
        bytes: bytes.length,
      })
      .run();
  }
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 9)]);
  const SHOT_ID = '6f0e8d3a-5b1c-4f7e-9a2d-3c4b5a697881';

  it('sends the screenshots after the lesson, once, and the platform shows them (H10)', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    online = false;
    const sessionId = await holdALesson(cookie);
    leaveAScreenshot(sessionId, SHOT_ID, JPEG);
    // Nothing can go: neither the lesson nor its picture.
    expect(await worker.push()).toBe(0);
    expect(worker.status()).toMatchObject({ pending: 1, pendingShots: 1 });

    online = true;
    expect(await worker.push()).toBe(1);
    expect(worker.status()).toMatchObject({ pending: 0, pendingShots: 0 });

    const stored = cloud.database.db.select().from(schema.screenshots).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: SHOT_ID, sessionId, studentId: 'student-01' });
    expect(readFileSync(join(cloud.config.dataDir, stored[0]?.fileKey ?? '')).equals(JPEG)).toBe(
      true,
    );
    // The teacher sees it in the lesson's results on the platform.
    const results = SessionResultsSchema.parse(
      (
        await cloud.app.inject({
          method: 'GET',
          url: `/api/sessions/${sessionId}/results`,
          headers: { cookie: cloudCookie },
        })
      ).json(),
    );
    expect(results.rows.find((r) => r.studentId === 'student-01')?.screenshotId).toBe(SHOT_ID);
    const picture = await cloud.app.inject({
      method: 'GET',
      url: `/api/screenshots/${SHOT_ID}`,
      headers: { cookie: cloudCookie },
    });
    expect(picture.statusCode).toBe(200);

    // A second tick has nothing to send, and sending the same picture again stores nothing new.
    expect(await worker.push()).toBe(0);
    schoolDb.db.update(schema.screenshots).set({ syncedAt: null }).run();
    await worker.push();
    expect(cloud.database.db.select().from(schema.screenshots).all()).toHaveLength(1);
  });

  it('drops a picture whose file is gone or which is no picture, and sends the rest', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    online = false;
    const sessionId = await holdALesson(cookie);
    leaveAScreenshot(sessionId, '11111111-1111-4111-8111-111111111111', Buffer.from('not a jpeg'));
    leaveAScreenshot(sessionId, SHOT_ID, JPEG);
    schoolDb.db
      .insert(schema.screenshots)
      .values({
        id: '22222222-2222-4222-8222-222222222222',
        sessionId,
        studentId: 'student-01',
        kind: 'manual',
        takenAt: new Date().toISOString(),
        fileKey: 'screenshots/none/gone.jpg',
        width: 10,
        height: 10,
        bytes: 1,
      })
      .run();
    online = true;
    await worker.push();
    expect(worker.status().pendingShots).toBe(0);
    expect(
      cloud.database.db
        .select()
        .from(schema.screenshots)
        .all()
        .map((s) => s.id),
    ).toEqual([SHOT_ID]);
    expect(existsSync(join(cloud.config.dataDir, 'screenshots', 'none'))).toBe(false);
  });

  it('carries the confirmed grades up, and takes back the ones the teacher removed (H10)', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    schoolDb.db
      .update(schema.classes)
      .set({ settings: { starsToGrade: true, codePics: [] } })
      .where(eq(schema.classes.id, DEMO.classId))
      .run();
    online = false;
    const sessionId = await holdALesson(cookie);
    online = true;
    await worker.push();
    expect(worker.status().pending).toBe(0);

    const put = (value: number | null) =>
      school.inject({
        method: 'PUT',
        url: `/api/sessions/${sessionId}/grades`,
        headers: { cookie },
        payload: { grades: [{ studentId: 'student-01', value }] },
      });
    online = false;
    const graded = SessionResultsSchema.parse((await put(5)).json());
    expect(graded.rows.find((r) => r.studentId === 'student-01')).toMatchObject({
      grade: 5,
      gradeConfirmed: true,
    });
    // The lesson waits again, now with its grade.
    expect(worker.status().pending).toBe(1);
    online = true;
    const inCloud = () =>
      cloud.database.db
        .select()
        .from(schema.grades)
        .where(eq(schema.grades.sessionId, sessionId))
        .all();
    await vi.waitFor(async () => {
      await worker.push();
      expect(inCloud()).toHaveLength(1);
    });
    expect(inCloud()[0]).toMatchObject({ studentId: 'student-01', value: 5 });

    // Setting a grade starts the sending by itself; wait for whichever send carries the change.
    await put(null);
    await vi.waitFor(async () => {
      await worker.push();
      expect(inCloud()).toHaveLength(0);
    });
  });
});
