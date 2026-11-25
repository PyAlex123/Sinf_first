import { afterEach, describe, expect, it } from 'vitest';
import { loginTeacher, TEACHER_PASSWORD, testApp, type TestApp } from './helpers.js';

/**
 * Test review 2026-11-25: on a classroom server the teacher acts only from the teacher's own
 * computer. A pupil's device on the same network may know the demo password (it was shown in the
 * window), but neither logs in nor uses a teacher's cookie from there.
 */
const PUPIL = '192.168.1.57';
let t: TestApp | null = null;

afterEach(async () => {
  await t?.close();
  t = null;
});

const login = (remoteAddress?: string) =>
  t!.app.inject({
    method: 'POST',
    url: '/api/auth/teacher',
    payload: { email: 'demo@sinf.local', password: TEACHER_PASSWORD },
    ...(remoteAddress ? { remoteAddress } : {}),
  });

describe('the teacher on a classroom server', () => {
  it('signs in on the teacher computer and nowhere else', async () => {
    t = await testApp({ CLASSROOM_MODE: '1' });
    expect((await login()).statusCode).toBe(200);
    const remote = await login(PUPIL);
    expect(remote.statusCode).toBe(403);
    expect(remote.json()).toMatchObject({ error: 'teacher_local_only' });
    expect(remote.cookies.find((c) => c.name === 'sinf_teacher')).toBeUndefined();

    const register = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: PUPIL,
      payload: { email: 'pupil@example.com', password: 'pupil-pass-1', fullName: 'Школьник' },
    });
    expect(register.statusCode).toBe(403);
  });

  it("does not take a teacher's cookie from another device", async () => {
    t = await testApp({ CLASSROOM_MODE: '1' });
    const cookie = await loginTeacher(t.app);
    const here = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(here.statusCode).toBe(200);
    const there = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
      remoteAddress: PUPIL,
    });
    expect(there.statusCode).toBe(401);
    const start = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      remoteAddress: PUPIL,
      payload: { classId: 'class-1a', lessonId: 'g10' },
    });
    expect(start.statusCode).toBe(401);
  });

  it('ignores a forwarded header that claims the request is local', async () => {
    t = await testApp({ CLASSROOM_MODE: '1' });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      remoteAddress: PUPIL,
      headers: { 'x-forwarded-for': '127.0.0.1' },
      payload: { email: 'demo@sinf.local', password: TEACHER_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('the teacher on the site', () => {
  it('signs in from anywhere, as before', async () => {
    t = await testApp({ CLASSROOM_MODE: '0' });
    expect((await login(PUPIL)).statusCode).toBe(200);
    const cookie = await loginTeacher(t.app);
    const there = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
      remoteAddress: PUPIL,
    });
    expect(there.statusCode).toBe(200);
  });
});
