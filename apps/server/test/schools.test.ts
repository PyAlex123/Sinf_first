import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AdminSchoolListResponseSchema,
  SchoolBriefSchema,
  MeResponseSchema,
  SchoolDetailsResponseSchema,
  SchoolListResponseSchema,
} from '@sinf/shared';
import { ensureSuperadmin } from '../src/db/seed.js';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, testApp, TEACHER_PASSWORD, type TestApp } from './helpers.js';

/**
 * S2.3: only we create a school; a teacher asks to join and the school's administrator decides.
 * Everything a teacher may not see answers 404.
 */

let t: TestApp;
/** The demo teacher, who is the administrator of the demo school. */
let admin: string;

const SUPER = { email: 'root@sinf.local', password: 'superparol123' };
const TEACHER = { fullName: 'Новый Учитель', email: 'new@example.com', password: 'parol12345' };

beforeEach(async () => {
  t = await testApp();
  admin = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

async function cookieOf(email: string, password: string): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/teacher',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  if (!jar) throw new Error('no cookie');
  return `${jar.name}=${jar.value}`;
}

async function registerTeacher(payload = TEACHER): Promise<string> {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/register', payload });
  expect(res.statusCode).toBe(200);
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  if (!jar) throw new Error('no cookie');
  return `${jar.name}=${jar.value}`;
}

/** Creates our account the way the server does at startup, then logs in. */
async function superadmin(): Promise<string> {
  ensureSuperadmin(t.database.db, SUPER);
  return cookieOf(SUPER.email, SUPER.password);
}

const me = async (cookie: string) =>
  MeResponseSchema.parse(
    (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json(),
  );

describe('superadmin', () => {
  it('creates a school and puts a registered teacher in charge', async () => {
    const root = await superadmin();
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schools',
      headers: { cookie: root },
      payload: { name: 'Школа № 5', city: 'Ташкент' },
    });
    expect(created.statusCode).toBe(200);
    const schoolId = z.strictObject({ school: SchoolBriefSchema }).parse(created.json()).school.id;

    const teacher = await registerTeacher();
    const assigned = await t.app.inject({
      method: 'POST',
      url: `/api/admin/schools/${schoolId}/admins`,
      headers: { cookie: root },
      payload: { email: TEACHER.email },
    });
    expect(assigned.statusCode).toBe(200);

    const mine = await me(teacher);
    expect(mine.schools).toEqual([
      { id: schoolId, name: 'Школа № 5', city: 'Ташкент', role: 'admin' },
    ]);

    const list = AdminSchoolListResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/admin/schools', headers: { cookie: root } })
      ).json(),
    );
    expect(list.schools.find((s) => s.id === schoolId)).toMatchObject({ teachers: 1 });
  });

  it('is invisible to a teacher: the area answers 404, not 403', async () => {
    await superadmin();
    for (const attempt of [
      { method: 'GET' as const, url: '/api/admin/schools' },
      { method: 'POST' as const, url: '/api/admin/schools', payload: { name: 'Своя школа' } },
    ]) {
      const res = await t.app.inject({ ...attempt, headers: { cookie: admin } });
      expect(`${attempt.url} → ${res.statusCode}`).toBe(`${attempt.url} → 404`);
    }
  });

  it('refuses an unknown email when assigning an administrator', async () => {
    const root = await superadmin();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/schools/${DEMO.schoolId}/admins`,
      headers: { cookie: root },
      payload: { email: 'nobody@example.com' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'user_not_found' });
  });

  it('raises an already registered teacher to superadmin instead of making a second account', async () => {
    const before = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'Я Сам', email: SUPER.email, password: SUPER.password },
    });
    expect(before.statusCode).toBe(200);
    expect(ensureSuperadmin(t.database.db, SUPER)).toEqual({ created: true });
    const root = await cookieOf(SUPER.email, SUPER.password);
    expect((await me(root)).isSuperadmin).toBe(true);
    // Running again changes nothing.
    expect(ensureSuperadmin(t.database.db, SUPER)).toEqual({ created: false });
  });
});

describe('asking to join a school', () => {
  it('shows the school list and remembers the request', async () => {
    const teacher = await registerTeacher();
    const list = SchoolListResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/schools', headers: { cookie: teacher } })
      ).json(),
    );
    expect(list.schools.map((s) => s.id)).toContain(DEMO.schoolId);

    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: teacher },
    });
    expect(asked.statusCode).toBe(200);
    expect((await me(teacher)).pendingSchool).toMatchObject({ id: DEMO.schoolId });

    const again = await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: teacher },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'request_pending' });
  });

  it('gives a waiting teacher nothing of the school', async () => {
    const teacher = await registerTeacher();
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: teacher },
    });
    const mine = await me(teacher);
    expect(mine.classes).toEqual([]);
    expect(mine.schools).toEqual([]);
    for (const url of [`/api/schools/${DEMO.schoolId}`, `/api/classes/${DEMO.classId}`]) {
      const res = await t.app.inject({ method: 'GET', url, headers: { cookie: teacher } });
      expect(`${url} → ${res.statusCode}`).toBe(`${url} → 404`);
    }
  });

  it('refuses a request from somebody who already belongs to the school', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: admin },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'already_member' });
  });

  it('asks everybody else to log in first', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/schools' })).statusCode).toBe(401);
  });
});

describe('the administrator decides', () => {
  async function waitingTeacher(): Promise<string> {
    const teacher = await registerTeacher();
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: teacher },
    });
    return teacher;
  }

  async function decide(userId: string, decision: 'approve' | 'reject', cookie = admin) {
    return t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests/${userId}`,
      headers: { cookie },
      payload: { decision },
    });
  }

  it('approves and the teacher sees the school classes', async () => {
    const teacher = await waitingTeacher();
    const cabinet = SchoolDetailsResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/schools/${DEMO.schoolId}`,
          headers: { cookie: admin },
        })
      ).json(),
    );
    expect(cabinet.requests).toHaveLength(1);
    expect(cabinet.classes[0]).toMatchObject({ name: DEMO.className, studentCount: 20 });
    const userId = cabinet.requests[0]?.userId as string;

    const res = await decide(userId, 'approve');
    expect(res.statusCode).toBe(200);
    expect(SchoolDetailsResponseSchema.parse(res.json()).requests).toEqual([]);

    const mine = await me(teacher);
    expect(mine.schools[0]).toMatchObject({ id: DEMO.schoolId, role: 'teacher' });
    expect(mine.classes.map((c) => c.id)).toEqual([DEMO.classId]);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/classes/${DEMO.classId}`,
          headers: { cookie: teacher },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('rejects, and the teacher may ask again later', async () => {
    const teacher = await waitingTeacher();
    const userId = (await me(teacher)).teacher.id;
    expect((await decide(userId, 'reject')).statusCode).toBe(200);
    const after = await me(teacher);
    expect(after.schools).toEqual([]);
    expect(after.pendingSchool).toBeNull();
    expect(after.classes).toEqual([]);

    const again = await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: teacher },
    });
    expect(again.statusCode).toBe(200);
  });

  it('removes a teacher and the school classes go away with the membership', async () => {
    const teacher = await waitingTeacher();
    const userId = (await me(teacher)).teacher.id;
    await decide(userId, 'approve');
    expect((await me(teacher)).classes).toHaveLength(1);

    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/api/schools/${DEMO.schoolId}/members/${userId}`,
      headers: { cookie: admin },
    });
    expect(removed.statusCode).toBe(200);
    const after = await me(teacher);
    expect(after.schools).toEqual([]);
    expect(after.classes).toEqual([]);
  });

  it('keeps at least one administrator', async () => {
    const adminId = (await me(admin)).teacher.id;
    const demoted = await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/members/${adminId}/role`,
      headers: { cookie: admin },
      payload: { role: 'teacher' },
    });
    expect(demoted.statusCode).toBe(409);
    expect(demoted.json()).toMatchObject({ error: 'last_admin' });

    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/api/schools/${DEMO.schoolId}/members/${adminId}`,
      headers: { cookie: admin },
    });
    expect(removed.statusCode).toBe(409);
  });

  it('renames the school and makes a colleague an administrator', async () => {
    const teacher = await waitingTeacher();
    const userId = (await me(teacher)).teacher.id;
    await decide(userId, 'approve');

    const renamed = await t.app.inject({
      method: 'PATCH',
      url: `/api/schools/${DEMO.schoolId}`,
      headers: { cookie: admin },
      payload: { name: 'Школа № 7', city: 'Самарканд' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(SchoolDetailsResponseSchema.parse(renamed.json()).school).toMatchObject({
      name: 'Школа № 7',
      city: 'Самарканд',
    });

    const promoted = await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/members/${userId}/role`,
      headers: { cookie: admin },
      payload: { role: 'admin' },
    });
    expect(promoted.statusCode).toBe(200);
    expect((await me(teacher)).schools[0]?.role).toBe('admin');
  });
});

describe('a plain teacher of the school', () => {
  it('sees the cabinet without addresses and requests, and may not decide anything', async () => {
    const teacher = await registerTeacher();
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: teacher },
    });
    const userId = (await me(teacher)).teacher.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests/${userId}`,
      headers: { cookie: admin },
      payload: { decision: 'approve' },
    });

    const view = SchoolDetailsResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/schools/${DEMO.schoolId}`,
          headers: { cookie: teacher },
        })
      ).json(),
    );
    expect(view.role).toBe('teacher');
    expect(view.requests).toEqual([]);
    expect(view.members.every((m) => m.email === null)).toBe(true);
    expect(view.classes).toHaveLength(1);

    const adminId = (await me(admin)).teacher.id;
    const attempts = [
      {
        method: 'PATCH' as const,
        url: `/api/schools/${DEMO.schoolId}`,
        payload: { name: 'Моя школа' },
      },
      {
        method: 'POST' as const,
        url: `/api/schools/${DEMO.schoolId}/members/${adminId}/role`,
        payload: { role: 'teacher' },
      },
      { method: 'DELETE' as const, url: `/api/schools/${DEMO.schoolId}/members/${adminId}` },
    ];
    for (const attempt of attempts) {
      const res = await t.app.inject({ ...attempt, headers: { cookie: teacher } });
      expect(`${attempt.method} ${attempt.url} → ${res.statusCode}`).toBe(
        `${attempt.method} ${attempt.url} → 404`,
      );
    }
  });
});

describe('demo data', () => {
  it('leaves the demo teacher as the administrator of the demo school', async () => {
    const mine = await me(admin);
    expect(mine.schools).toEqual([
      { id: DEMO.schoolId, name: DEMO.schoolName, city: null, role: 'admin' },
    ]);
    expect(mine.isSuperadmin).toBe(false);
    expect(TEACHER_PASSWORD).toBe('demo1234');
  });
});
