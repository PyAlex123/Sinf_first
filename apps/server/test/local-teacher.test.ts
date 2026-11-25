import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
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

describe('the lock a classroom computer keeps', () => {
  const HOST = 'host-token-0123456789abcdef';
  const locked = (query: string, headers: Record<string, string>, remoteAddress?: string) =>
    t!.app.inject({
      method: 'GET',
      url: `/api/join/room/locked${query}`,
      headers,
      ...(remoteAddress ? { remoteAddress } : {}),
    });

  it('is told only to Sinf on the teacher computer, and follows "Attention!"', async () => {
    t = await testApp({ CLASSROOM_MODE: '1', HOST_TOKEN: HOST });
    expect((await locked('?pc=ПК-05', {})).statusCode).toBe(404);
    expect((await locked('?pc=ПК-05', { 'x-host-token': HOST }, PUPIL)).statusCode).toBe(404);
    expect((await locked('?pc=ПК-05', { 'x-host-token': HOST })).json()).toEqual({
      locked: false,
    });

    const cookie = await loginTeacher(t.app);
    const started = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: 'class-1a', lessonId: 'g10' },
    });
    const sessionId = started.json<{ session: { id: string } }>().session.id;
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const address = t.app.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?session=${sessionId}&role=teacher`,
      { headers: { cookie } },
    );
    await new Promise((resolve) => socket.once('message', resolve));
    socket.send(JSON.stringify({ v: 1, type: 'teacher.lock', targets: 'all' }));
    for (let i = 0; i < 20; i++) {
      if ((await locked('?pc=ПК-05', { 'x-host-token': HOST })).json<{ locked: boolean }>().locked)
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await locked('?pc=ПК-05', { 'x-host-token': HOST })).json()).toEqual({ locked: true });
    expect((await locked('', { 'x-host-token': HOST })).json()).toEqual({ locked: true });
    socket.send(JSON.stringify({ v: 1, type: 'teacher.unlock', targets: 'all' }));
    for (let i = 0; i < 20; i++) {
      if (!(await locked('?pc=ПК-05', { 'x-host-token': HOST })).json<{ locked: boolean }>().locked)
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await locked('?pc=ПК-05', { 'x-host-token': HOST })).json()).toEqual({ locked: false });
    socket.close();
  });

  it('is not asked on the site at all', async () => {
    t = await testApp({ CLASSROOM_MODE: '0', HOST_TOKEN: HOST });
    expect((await locked('?pc=ПК-05', { 'x-host-token': HOST })).statusCode).toBe(404);
  });
});
