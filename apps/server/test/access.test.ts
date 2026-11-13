import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  JoinClassesResponseSchema,
  MeResponseSchema,
  SessionResponseSchema,
} from '@sinf/shared';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/**
 * S2.1: registration and the access boundary (ADR-009). A second teacher on the public site must not
 * reach anything of the first one — the whole point of the step.
 */

let t: TestApp;

beforeEach(async () => {
  t = await testApp();
});

afterEach(async () => {
  await t.close();
});

const OUTSIDER = {
  fullName: 'Новый Учитель',
  email: 'outsider@example.com',
  password: 'parol12345',
};

/** Registers a teacher and returns their cookie header. */
async function registerTeacher(payload = OUTSIDER): Promise<string> {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/register', payload });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'sinf_teacher');
  if (!cookie) throw new Error('No teacher cookie after registration');
  return `${cookie.name}=${cookie.value}`;
}

describe('registration', () => {
  it('creates a teacher who is logged in and starts with an empty space', async () => {
    const cookie = await registerTeacher();
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    const body = MeResponseSchema.parse(me.json());
    expect(body.teacher.email).toBe(OUTSIDER.email);
    expect(body.classes).toEqual([]);
  });

  it('lowercases the email and refuses a second registration with it', async () => {
    await registerTeacher({ ...OUTSIDER, email: 'Outsider@Example.com' });
    const again = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: OUTSIDER,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'email_taken' });
  });

  it('refuses a short password', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...OUTSIDER, password: 'korotko' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation' });
  });

  it('lets the new teacher log in with their password', async () => {
    await registerTeacher();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      payload: { email: OUTSIDER.email, password: OUTSIDER.password },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('login attempts', () => {
  it('locks the email after five wrong passwords and tells how long to wait', async () => {
    await registerTeacher();
    const wrong = { email: OUTSIDER.email, password: 'ne-tot-parol' };
    for (let i = 0; i < 4; i++) {
      const res = await t.app.inject({ method: 'POST', url: '/api/auth/teacher', payload: wrong });
      expect(res.statusCode).toBe(401);
    }
    const fifth = await t.app.inject({ method: 'POST', url: '/api/auth/teacher', payload: wrong });
    expect(fifth.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(fifth.json()).details).toMatchObject({ attemptsLeft: 0 });

    // Even the right password waits now.
    const right = await t.app.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      payload: { email: OUTSIDER.email, password: OUTSIDER.password },
    });
    expect(right.statusCode).toBe(429);
    expect(ApiErrorSchema.parse(right.json()).details?.['retryAfterSec']).toBeGreaterThan(0);

    // Another teacher is not affected by someone else's failures.
    const demo = await t.app.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      payload: { email: DEMO.teacherEmail, password: 'demo1234' },
    });
    expect(demo.statusCode).toBe(200);
  });
});

describe('access boundary', () => {
  it('hides the demo class, its students and its lesson from an outside teacher', async () => {
    const owner = await loginTeacher(t.app);
    const outsider = await registerTeacher();

    // The owner sees the class and starts a lesson.
    const mine = MeResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: owner } })).json(),
    );
    expect(mine.classes.map((c) => c.id)).toEqual([DEMO.classId]);
    const started = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: owner },
      payload: { classId: DEMO.classId, lessonId: 'g10' },
    });
    expect(started.statusCode).toBe(200);
    const sessionId = SessionResponseSchema.parse(started.json()).session.id;
    const studentId = 'student-01';

    // The outsider sees nothing of it: 404 everywhere, never 403.
    const attempts = [
      { method: 'GET' as const, url: `/api/classes/${DEMO.classId}` },
      { method: 'POST' as const, url: `/api/students/${studentId}/code` },
      { method: 'GET' as const, url: `/api/sessions/${sessionId}` },
      { method: 'POST' as const, url: `/api/sessions/${sessionId}/end` },
    ];
    for (const attempt of attempts) {
      const res = await t.app.inject({ ...attempt, headers: { cookie: outsider } });
      // The url is in the message, so a failure says which route leaked.
      expect(`${attempt.url} → ${res.statusCode}`).toBe(`${attempt.url} → 404`);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    }

    // And cannot start a lesson for somebody else's class.
    const steal = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: outsider },
      payload: { classId: DEMO.classId, lessonId: 'g10' },
    });
    expect(steal.statusCode).toBe(404);

    // The owner is unaffected and still runs the lesson.
    const own = await t.app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
      headers: { cookie: owner },
    });
    expect(own.statusCode).toBe(200);
  });

  it('asks everybody else to log in first', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/classes/${DEMO.classId}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('public class list', () => {
  it('shows only classes with a lesson going on', async () => {
    const empty = await t.app.inject({ method: 'GET', url: '/api/join/classes' });
    expect(JoinClassesResponseSchema.parse(empty.json()).classes).toEqual([]);

    const owner = await loginTeacher(t.app);
    await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: owner },
      payload: { classId: DEMO.classId, lessonId: 'g10' },
    });
    const running = JoinClassesResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/join/classes' })).json(),
    );
    expect(running.classes).toHaveLength(1);
    expect(running.classes[0]).toMatchObject({ id: DEMO.classId });
  });
});
