import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AdminSchoolListResponseSchema,
  SchoolDetailsResponseSchema,
  SuperadminLicensesResponseSchema,
} from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { DEMO, ensureSuperadmin } from '../src/db/seed.js';
import { applySchoolSnapshot } from '../src/sync/mirror.js';
import { buildSchoolSnapshot } from '../src/sync/snapshot.js';
import { requireClassroomLesson, schoolLicense } from '../src/services/licenses.js';
import { loginTeacher, registerTeacher, testApp, testDatabase, type TestApp } from './helpers.js';

/** B2 (stage 6): what a school has paid for, and what stays free. */

let t: TestApp;
let cookie: string;

const ROOT = { email: 'root@sinf.uz', password: 'root-pass-1234' };

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  for (const id of t.app.sessions.liveSessionIds()) t.app.sessions.end(id);
  await t.close();
});

async function root(): Promise<string> {
  ensureSuperadmin(t.database.db, ROOT);
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/teacher', payload: ROOT });
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  return `${jar?.name}=${jar?.value}`;
}

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, as: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie: as }, ...(payload ? { payload } : {}) });

describe('the superadmin', () => {
  it('issues, sees and takes back a school’s license', async () => {
    const admin = await root();
    const base = `/api/admin/schools/${DEMO.schoolId}/licenses`;
    const issued = SuperadminLicensesResponseSchema.parse(
      (
        await call('POST', base, admin, {
          classesLimit: 3,
          validFrom: '2020-09-01',
          validTo: '2999-05-31',
          note: 'пилот',
        })
      ).json(),
    );
    expect(issued.licenses[0]).toMatchObject({ classesLimit: 3, note: 'пилот' });
    const list = AdminSchoolListResponseSchema.parse(
      (await call('GET', '/api/admin/schools', admin)).json(),
    );
    const demo = list.schools.find((s) => s.id === DEMO.schoolId);
    // The longest one in force counts: the pilot to 2999 over the demo's two years.
    expect(demo?.license).toMatchObject({
      status: 'active',
      classesUsed: 1,
      terms: { classesLimit: 3 },
    });

    await call('DELETE', `${base}/${issued.licenses[0]?.id}`, admin);
    expect(schoolLicense(t.database.db, DEMO.schoolId).terms?.classesLimit).toBe(20);
    // Not the superadmin: no such thing.
    expect(
      (
        await call('POST', base, cookie, {
          classesLimit: 3,
          validFrom: '2020-09-01',
          validTo: '2999-01-01',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', base, admin, {
          classesLimit: 3,
          validFrom: '2027-01-01',
          validTo: '2026-01-01',
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('what a school pays for', () => {
  it('classes of the school within the license, and none without one', async () => {
    t.database.db.update(schema.licenses).set({ classesLimit: 2 }).run();
    const first = await call('POST', '/api/classes', cookie, { name: '5А', grade: 5 });
    expect(first.statusCode).toBe(200);
    const over = await call('POST', '/api/classes', cookie, { name: '5Б', grade: 5 });
    expect([over.statusCode, over.json<{ error: string }>().error]).toEqual([409, 'license_limit']);

    t.database.db.update(schema.licenses).set({ validTo: '2000-01-01' }).run();
    const none = await call('POST', '/api/classes', cookie, { name: '5В', grade: 5 });
    expect(none.json<{ error: string }>().error).toBe('license_needed');
    const details = SchoolDetailsResponseSchema.parse(
      (await call('GET', `/api/schools/${DEMO.schoolId}`, cookie)).json(),
    );
    expect(details.license).toMatchObject({ status: 'expired', classesUsed: 2 });
    // The school's reports too.
    expect((await call('GET', `/api/schools/${DEMO.schoolId}/reports`, cookie)).statusCode).toBe(
      409,
    );
  });

  it('a lesson on a classroom computer: a licensed school’s class, with 14 days of grace', () => {
    const db = t.database.db;
    expect(() => requireClassroomLesson(db, DEMO.classId)).not.toThrow();
    const today = new Date();
    const ago = (days: number) =>
      new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    db.update(schema.licenses)
      .set({ validTo: ago(10) })
      .run();
    expect(() => requireClassroomLesson(db, DEMO.classId)).not.toThrow();
    db.update(schema.licenses)
      .set({ validTo: ago(20) })
      .run();
    expect(() => requireClassroomLesson(db, DEMO.classId)).toThrow(/license/);
  });

  it('on the teacher’s computer the lesson is refused without the license, and a personal class goes to the website', async () => {
    const pc = await testApp({ CLASSROOM_MODE: '1' });
    try {
      const teacher = await loginTeacher(pc.app);
      const ok = await pc.app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { cookie: teacher },
        payload: { classId: DEMO.classId, lessonId: 'g10' },
      });
      expect(ok.statusCode).toBe(200);
      pc.database.db.update(schema.licenses).set({ revokedAt: new Date().toISOString() }).run();
      const refused = await pc.app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { cookie: teacher },
        payload: { classId: DEMO.classId, lessonId: 'g11' },
      });
      expect(refused.json<{ error: string }>().error).toBe('license_needed');

      const outsider = await registerTeacher(pc.app);
      const own = (
        await pc.app.inject({
          method: 'POST',
          url: '/api/classes',
          headers: { cookie: outsider },
          payload: { name: '7А', grade: 7 },
        })
      ).json<{ class: { id: string } }>();
      const personal = await pc.app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { cookie: outsider },
        payload: { classId: own.class.id, lessonId: 'g10' },
      });
      expect(personal.json<{ error: string }>().error).toBe('license_personal');
    } finally {
      for (const id of pc.app.sessions.liveSessionIds()) pc.app.sessions.end(id);
      await pc.close();
    }
  });

  it('travels to the school computer with the roster', () => {
    const snapshot = buildSchoolSnapshot(t.database.db, DEMO.schoolId);
    expect(snapshot?.license).toMatchObject({ classesLimit: 20 });
    const pc = testDatabase(false);
    try {
      if (!snapshot) throw new Error('no snapshot');
      applySchoolSnapshot(pc.db, snapshot);
      expect(() => requireClassroomLesson(pc.db, DEMO.classId)).not.toThrow();
      applySchoolSnapshot(pc.db, { ...snapshot, license: null });
      expect(() => requireClassroomLesson(pc.db, DEMO.classId)).toThrow(/license/);
    } finally {
      pc.close();
    }
  });
});

describe('what stays free', () => {
  it('one personal class of a teacher in no school, web lessons with it', async () => {
    const outsider = await registerTeacher(t.app);
    const first = await call('POST', '/api/classes', outsider, { name: '7А', grade: 7 });
    expect(first.statusCode).toBe(200);
    const second = await call('POST', '/api/classes', outsider, { name: '7Б', grade: 7 });
    expect(second.json<{ error: string }>().error).toBe('free_limit');
    const id = first.json<{ class: { id: string } }>().class.id;
    // On the website a lesson needs no license.
    const lesson = await call('POST', '/api/sessions', outsider, { classId: id, lessonId: 'g10' });
    expect(lesson.statusCode).toBe(200);
    expect(
      t.database.db.select().from(schema.classes).where(eq(schema.classes.id, id)).get()?.schoolId,
    ).toBeNull();
  });
});
