import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  JournalSchema,
  ClassProgramSchema,
  AssetUploadResponseSchema,
  AuthoredLessonListResponseSchema,
  AuthoredLessonSchema,
  LessonSchema,
  DeviceSchema,
  JoinResponseSchema,
  PairDeviceResponseSchema,
  SessionResponseSchema,
  FileUploadResponseSchema,
  SessionResultsSchema,
  StudentFilesResponseSchema,
  SyncStatusSchema,
} from '@sinf/shared';
import { buildApp } from '../src/app.js';
import { REPO_ROOT } from '../src/config.js';
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
      method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: url.pathname + url.search,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === 'string'
        ? { payload: init.body }
        : init?.body instanceof Uint8Array
          ? { payload: Buffer.from(init.body) }
          : {}),
    });
    return new Response(new Uint8Array(res.rawPayload), {
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

describe('teachers’ own lessons coming down (W1, ADR-019)', () => {
  it('brings the school’s lessons and their pictures, read-only, and drops deleted ones', async () => {
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
        '1f15c4890000000d49444154789c636060606000000005000157a0c0b30000000049454e44ae426082',
      'hex',
    );
    const up = await cloud.app.inject({
      method: 'POST',
      url: '/api/assets?ext=png',
      headers: { cookie: cloudCookie, 'content-type': 'application/octet-stream' },
      payload: png,
    });
    const asset = AssetUploadResponseSchema.parse(up.json());
    const made = AuthoredLessonSchema.parse(
      (
        await cloud.app.inject({
          method: 'POST',
          url: '/api/authored-lessons',
          headers: { cookie: cloudCookie },
          payload: { title: 'Урок учителя', grade: 5 },
        })
      ).json(),
    );
    const doc = structuredClone(made.doc);
    const first = doc.stages[0]?.blocks[0];
    if (first?.kind !== 'slide') throw new Error('no slide');
    first.image = { sha: asset.sha, ext: 'png', width: 1, height: 1 };
    await cloud.app.inject({
      method: 'PUT',
      url: `/api/authored-lessons/${made.id}`,
      headers: { cookie: cloudCookie },
      payload: { title: made.title, grade: 5, topic: '', visibility: 'private', doc, version: 1 },
    });

    await worker.pull();
    const played = LessonSchema.parse(
      (await school.inject({ method: 'GET', url: `/api/lessons/${made.id}` })).json(),
    );
    expect(played.title).toBe('Урок учителя');
    const picture = await school.inject({ method: 'GET', url: asset.url });
    expect(picture.rawPayload.equals(png)).toBe(true);

    // On the school computer the teacher sees it and cannot change it there.
    const cookie = await teacherCookie();
    const here = AuthoredLessonSchema.parse(
      (
        await school.inject({
          method: 'GET',
          url: `/api/authored-lessons/${made.id}`,
          headers: { cookie },
        })
      ).json(),
    );
    expect(here.editable).toBe(false);
    const edit = await school.inject({
      method: 'PUT',
      url: `/api/authored-lessons/${made.id}`,
      headers: { cookie },
      payload: { title: 'Здесь', grade: 5, topic: '', visibility: 'private', doc, version: 2 },
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ error: 'edit_on_platform' });

    await cloud.app.inject({
      method: 'DELETE',
      url: `/api/authored-lessons/${made.id}`,
      headers: { cookie: cloudCookie },
    });
    await worker.pull();
    const list = AuthoredLessonListResponseSchema.parse(
      (
        await school.inject({ method: 'GET', url: '/api/authored-lessons', headers: { cookie } })
      ).json(),
    );
    expect(list.lessons).toEqual([]);
  });
});

describe('a class’s programme coming down (W7)', () => {
  it('shows the next lesson on the school computer', async () => {
    const made = (
      await cloud.app.inject({
        method: 'POST',
        url: '/api/programs',
        headers: { cookie: cloudCookie },
        payload: { title: 'Год 1А', grade: 1 },
      })
    ).json<{ id: string }>();
    await cloud.app.inject({
      method: 'PUT',
      url: `/api/programs/${made.id}`,
      headers: { cookie: cloudCookie },
      payload: {
        title: 'Год 1А',
        grade: 1,
        visibility: 'private',
        items: [
          { lessonId: 'g10', quarter: 2 },
          { lessonId: 'g11', quarter: 2 },
        ],
        version: 1,
      },
    });
    await cloud.app.inject({
      method: 'PUT',
      url: `/api/classes/${DEMO.classId}/program`,
      headers: { cookie: cloudCookie },
      payload: { programId: made.id },
    });
    await worker.pull();
    const cookie = await teacherCookie();
    const here = ClassProgramSchema.parse(
      (
        await school.inject({
          method: 'GET',
          url: `/api/classes/${DEMO.classId}/program`,
          headers: { cookie },
        })
      ).json(),
    );
    expect(here.program?.title).toBe('Год 1А');
    expect(here.next?.lessonId).toBe('g10');
  });
});

describe('the journal’s own columns, both ways (W9)', () => {
  it('a grade typed at school reaches the website, and one typed at home comes back', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    const made = JournalSchema.parse(
      (
        await school.inject({
          method: 'POST',
          url: `/api/journal/${DEMO.classId}/columns`,
          headers: { cookie },
          payload: { date: '2026-11-20', title: 'Устно' },
        })
      ).json(),
    );
    const columnId = made.lessons[0]?.columnId ?? '';
    await school.inject({
      method: 'PUT',
      url: `/api/journal/${DEMO.classId}/cell`,
      headers: { cookie },
      payload: { column: { kind: 'manual', columnId }, studentId: 'student-01', value: 4 },
    });
    await worker.push();
    const cloudJournal = async () =>
      JournalSchema.parse(
        (
          await cloud.app.inject({
            method: 'GET',
            url: `/api/journal/${DEMO.classId}`,
            headers: { cookie: cloudCookie },
          })
        ).json(),
      );
    const there = await cloudJournal();
    expect(there.lessons.map((l) => l.lessonTitle)).toEqual(['Устно']);
    expect(there.students.find((s) => s.id === 'student-01')?.cells[0]?.grade).toBe(4);

    // At home the teacher changes it on the website.
    await new Promise((r) => setTimeout(r, 5));
    await cloud.app.inject({
      method: 'PUT',
      url: `/api/journal/${DEMO.classId}/cell`,
      headers: { cookie: cloudCookie },
      payload: { column: { kind: 'manual', columnId }, studentId: 'student-01', value: 5 },
    });
    await worker.pull();
    const here = JournalSchema.parse(
      (
        await school.inject({
          method: 'GET',
          url: `/api/journal/${DEMO.classId}`,
          headers: { cookie },
        })
      ).json(),
    );
    expect(here.students.find((s) => s.id === 'student-01')?.cells[0]?.grade).toBe(5);
  });
});

describe('the practice going up (H16)', () => {
  it('carries the work handed in and the teacher’s marks to the platform’s results', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    const created = await school.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: DEMO.classId, lessonId: 'proba-dokument' },
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
    const { token } = JoinResponseSchema.parse(joined.json());
    const lesson = { 'x-session-id': session.id, 'x-participant-token': token };
    const folder = StudentFilesResponseSchema.parse(
      (await school.inject({ method: 'GET', url: '/api/my/files', headers: lesson })).json(),
    );
    const template = folder.files.find((f) => f.name === 'Оформи документ.docx');
    expect(template).toBeDefined();
    const done = readFileSync(
      join(REPO_ROOT, 'apps/server/test/fixtures/practice/oformi-dokument-done.docx'),
    );
    const saved = await school.inject({
      method: 'PUT',
      url: `/api/my/files?name=${encodeURIComponent('Оформи документ.docx')}&base=${template?.sha256 ?? ''}`,
      headers: { ...lesson, 'content-type': 'application/octet-stream' },
      payload: done,
    });
    expect(saved.statusCode).toBe(200);
    await school.inject({
      method: 'PUT',
      url: `/api/sessions/${session.id}/practice-marks`,
      headers: { cookie },
      payload: { studentId: 'student-01', marks: { spelling: true } },
    });
    await school.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/end`,
      headers: { cookie },
    });

    const cloudRow = async () =>
      SessionResultsSchema.parse(
        (
          await cloud.app.inject({
            method: 'GET',
            url: `/api/sessions/${session.id}/results`,
            headers: { cookie: cloudCookie },
          })
        ).json(),
      ).rows.find((r) => r.studentId === 'student-01');
    await vi.waitFor(async () => {
      await worker.push();
      expect((await cloudRow())?.check).toMatchObject({ points: 12, max: 14, submitted: true });
    });

    // A mark after the lesson sends the lesson again.
    await school.inject({
      method: 'PUT',
      url: `/api/sessions/${session.id}/practice-marks`,
      headers: { cookie },
      payload: { studentId: 'student-01', marks: { neat: true } },
    });
    await vi.waitFor(async () => {
      await worker.push();
      expect((await cloudRow())?.check?.points).toBe(14);
    });
  });
});

describe('"Мои работы" between the school and the platform (H12)', () => {
  /** The platform's view of a child's folder: home, or a teacher there. */
  const cloudFiles = async (studentId = 'student-01') =>
    StudentFilesResponseSchema.parse(
      (
        await cloud.app.inject({
          method: 'GET',
          url: `/api/students/${studentId}/files`,
          headers: { cookie: cloudCookie },
        })
      ).json(),
    ).files;
  const schoolFiles = () =>
    schoolDb.db
      .select()
      .from(schema.studentFiles)
      .all()
      .filter((f) => !f.deletedAt)
      .map((f) => f.name)
      .sort();

  /** A child in a lesson on the school computer, with the headers their page sends. */
  async function childOnSchoolPc(cookie: string): Promise<Record<string, string>> {
    const created = await school.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: DEMO.classId, lessonId: 'k10' },
    });
    const { session } = SessionResponseSchema.parse(created.json());
    const student = schoolDb.db
      .select()
      .from(schema.students)
      .where(eq(schema.students.id, 'student-01'))
      .get();
    const joined = await school.inject({
      method: 'POST',
      url: '/api/join',
      payload: {
        sessionId: session.id,
        studentId: 'student-01',
        code: student?.codePublic.split('+'),
      },
    });
    const { token } = JoinResponseSchema.parse(joined.json());
    return { 'x-session-id': session.id, 'x-participant-token': token };
  }
  const saveAt = (
    app: FastifyInstance,
    headers: Record<string, string>,
    name: string,
    text: string,
    base?: string,
  ) =>
    app.inject({
      method: 'PUT',
      url: `/api/my/files?${new URLSearchParams({ name, ...(base ? { base } : {}) }).toString()}`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(text),
    });

  /** The child at home: on the platform, with the home cookie made by hand for the test. */
  function childAtHome(): Record<string, string> {
    // The demo class uses picture codes (no home login), so the cookie is signed directly.
    const signed = cloud.app.signCookie(`student-01|${Date.now() + 3_600_000}`);
    return { cookie: `sinf_student=${signed}` };
  }

  it('sends the lesson’s work up, brings the home work down, and keeps both when both changed', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    const child = await childOnSchoolPc(cookie);

    // In the lesson, without internet: saved on the teacher's computer, waiting.
    online = false;
    const v1 = FileUploadResponseSchema.parse(
      (await saveAt(school, child, 'Рисунок.png', 'v1')).json(),
    );
    expect(worker.status().pendingFiles).toBe(1);
    online = true;
    await worker.push();
    expect(worker.status().pendingFiles).toBe(0);
    expect((await cloudFiles()).map((f) => [f.name, f.sha256])).toEqual([
      ['Рисунок.png', v1.file.sha256],
    ]);

    // At home the child carries on with the drawing.
    const home = childAtHome();
    const homeV2 = FileUploadResponseSchema.parse(
      (await saveAt(cloud.app, home, 'Рисунок.png', 'v2 from home', v1.file.sha256)).json(),
    );
    expect(homeV2.conflictWith).toBeNull();

    // Next lesson: logging in brings the home version down.
    await worker.pullFiles('student-01');
    const local = schoolDb.db.select().from(schema.studentFiles).all();
    expect(local.map((f) => [f.name, f.sha256, f.dirty])).toEqual([
      ['Рисунок.png', homeV2.file.sha256, false],
    ]);
    expect(
      readFileSync(
        join(schoolDataDir, 'files', homeV2.file.sha256.slice(0, 2), homeV2.file.sha256),
      ).toString(),
    ).toBe('v2 from home');

    // Both change it without a connection between them: the platform keeps both.
    online = false;
    await saveAt(school, child, 'Рисунок.png', 'v3 at school', homeV2.file.sha256);
    await saveAt(cloud.app, home, 'Рисунок.png', 'v3 at home', homeV2.file.sha256);
    online = true;
    await worker.push();
    await worker.pullFiles('student-01');
    const names = (await cloudFiles()).map((f) => f.name).sort();
    expect(names).toEqual(['Рисунок (копия браузер).png', 'Рисунок.png']);
    expect(schoolFiles()).toEqual(names);
  });

  it('carries a deletion both ways, and not over a newer change', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    const child = await childOnSchoolPc(cookie);
    const a = FileUploadResponseSchema.parse(
      (await saveAt(school, child, 'a.txt', 'a')).json(),
    ).file;
    await saveAt(school, child, 'b.txt', 'b');
    await worker.push();
    expect((await cloudFiles()).map((f) => f.name)).toEqual(['a.txt', 'b.txt']);

    // Deleted at school → deleted on the platform.
    await school.inject({ method: 'DELETE', url: `/api/my/files/${a.id}`, headers: child });
    expect(worker.status().pendingFiles).toBe(1);
    await worker.push();
    expect((await cloudFiles()).map((f) => f.name)).toEqual(['b.txt']);
    expect(schoolDb.db.select().from(schema.studentFiles).all()).toHaveLength(1);

    // Deleted at home → gone from the school at the next login.
    const home = childAtHome();
    const b = (await cloudFiles())[0];
    await cloud.app.inject({ method: 'DELETE', url: `/api/my/files/${b?.id}`, headers: home });
    await worker.pullFiles('student-01');
    expect(schoolFiles()).toEqual([]);
  });

  it('works on without internet and says what waits', async () => {
    await worker.pull();
    const cookie = await teacherCookie();
    const child = await childOnSchoolPc(cookie);
    online = false;
    expect(await worker.pullFiles('student-01')).toBe(0);
    expect((await saveAt(school, child, 'c.txt', 'c')).statusCode).toBe(200);
    const status = SyncStatusSchema.parse(
      (await school.inject({ method: 'GET', url: '/api/sync/status', headers: { cookie } })).json(),
    );
    expect(status.pendingFiles).toBe(1);
  });

  it('gives a device nothing of another school', async () => {
    await worker.pull();
    const res = await cloud.app.inject({
      method: 'GET',
      url: '/api/sync/files/student-01',
      headers: { authorization: 'Device not-a-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});
