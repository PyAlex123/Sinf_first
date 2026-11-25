import { afterEach, describe, expect, it } from 'vitest';
import { LogMailer } from '../src/services/mailer.js';
import { TEACHER_PASSWORD, testApp, type TestApp } from './helpers.js';

/**
 * Review 2026-11-25: the site on the author's own server. A login cookie used to be Secure
 * whenever NODE_ENV was production, so by plain http://IP the browser dropped it and nobody stayed
 * logged in. Now it follows the request's protocol, and behind Caddy (TRUST_PROXY) the forwarded
 * protocol and address count.
 */
let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const login = (headers: Record<string, string> = {}, remoteAddress?: string) =>
  t!.app.inject({
    method: 'POST',
    url: '/api/auth/teacher',
    headers,
    payload: { email: 'demo@sinf.local', password: TEACHER_PASSWORD },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
const loginCookie = (res: Awaited<ReturnType<typeof login>>) =>
  res.cookies.find((c) => c.name === 'sinf_teacher');

describe('the login cookie', () => {
  it('is not Secure over plain http, even in production, and keeps the teacher logged in', async () => {
    t = await testApp({ NODE_ENV: 'production' });
    const res = await login();
    expect(res.statusCode).toBe(200);
    const cookie = loginCookie(res);
    expect(cookie?.secure).toBeFalsy();
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `${cookie?.name}=${cookie?.value}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('is Secure over HTTPS behind the proxy', async () => {
    t = await testApp({ NODE_ENV: 'production', TRUST_PROXY: '1' });
    expect(loginCookie(await login({ 'x-forwarded-proto': 'https' }))?.secure).toBe(true);
  });

  it('does not believe a forwarded protocol without TRUST_PROXY', async () => {
    t = await testApp({ NODE_ENV: 'production' });
    expect(loginCookie(await login({ 'x-forwarded-proto': 'https' }))?.secure).toBeFalsy();
  });

  it('can be made always Secure', async () => {
    t = await testApp({ COOKIE_SECURE: '1' });
    expect(loginCookie(await login())?.secure).toBe(true);
  });
});

describe('behind the proxy', () => {
  const pilot = (ip: string) =>
    t!.app.inject({
      method: 'POST',
      url: '/api/pilot-requests',
      headers: { 'x-forwarded-for': ip },
      payload: {
        school: 'Школа № 12',
        city: 'Ташкент',
        name: 'Каримова Дилноза',
        contact: '+998 90 123 45 67',
        locale: 'ru',
      },
    });

  it('counts attempts per visitor, not per proxy', async () => {
    t = await testApp({ TRUST_PROXY: '1' });
    for (let i = 0; i < 3; i++) expect((await pilot('203.0.113.7')).statusCode).toBe(201);
    expect((await pilot('203.0.113.7')).statusCode).toBe(429);
    expect((await pilot('198.51.100.9')).statusCode).toBe(201);
  });

  it('builds reset links with https', async () => {
    const mail = new LogMailer();
    t = await testApp({ TRUST_PROXY: '1' }, { mailer: mail });
    await t.app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'lesson.example.uz' },
      payload: { email: 'demo@sinf.local' },
    });
    expect(mail.sent[0]?.text).toMatch(/https:\/\/lesson\.example\.uz\/teacher\/reset\//);
  });
});
