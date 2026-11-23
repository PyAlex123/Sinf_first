import { afterEach, describe, expect, it } from 'vitest';
import { PilotRequestListResponseSchema, SiteInfoSchema } from '@sinf/shared';
import { ensureSuperadmin } from '../src/db/seed.js';
import { LogMailer } from '../src/services/mailer.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** B10 (stage 6): the landing page's server side — what kind of site this is, pilot requests. */

const ROOT = { email: 'root@sinf.uz', password: 'root-pass-1234' };

const REQUEST = {
  school: 'Школа № 12',
  city: 'Ташкент',
  name: 'Каримова Дилноза',
  contact: '+998 90 123 45 67',
  classes: 4,
  comment: 'Хотим попробовать на 7-х классах',
  locale: 'ru',
};

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

async function root(app: TestApp): Promise<string> {
  ensureSuperadmin(app.database.db, ROOT);
  const res = await app.app.inject({ method: 'POST', url: '/api/auth/teacher', payload: ROOT });
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  return `${jar?.name}=${jar?.value}`;
}

const send = (app: TestApp, payload: object, ip = '10.0.0.1') =>
  app.app.inject({ method: 'POST', url: '/api/pilot-requests', payload, remoteAddress: ip });

const list = async (app: TestApp, cookie: string) =>
  PilotRequestListResponseSchema.parse(
    (
      await app.app.inject({
        method: 'GET',
        url: '/api/admin/pilot-requests',
        headers: { cookie },
      })
    ).json(),
  ).requests;

describe('the kind of site', () => {
  it('is the platform, or a classroom server that keeps the plain front page', async () => {
    t = await testApp();
    const platform = SiteInfoSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/site' })).json(),
    );
    expect(platform.kind).toBe('platform');
    await t.close();
    t = await testApp({ CLASSROOM_MODE: '1' });
    const classroom = SiteInfoSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/site' })).json(),
    );
    expect(classroom.kind).toBe('classroom');
  });
});

describe('a pilot request', () => {
  it('is kept without logging in, sent to us by mail and seen by the superadmin alone', async () => {
    const mail = new LogMailer();
    t = await testApp(
      { SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password },
      { mailer: mail },
    );
    const res = await send(t, REQUEST);
    expect(res.statusCode, res.body).toBe(201);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe(ROOT.email);
    expect(mail.sent[0]?.text).toContain('Школа № 12');
    expect(mail.sent[0]?.text).toContain('+998 90 123 45 67');

    const teacher = await loginTeacher(t.app);
    const denied = await t.app.inject({
      method: 'GET',
      url: '/api/admin/pilot-requests',
      headers: { cookie: teacher },
    });
    expect(denied.statusCode).toBe(404);

    const admin = await root(t);
    const [kept] = await list(t, admin);
    expect(kept).toMatchObject({ ...REQUEST, handledAt: null });
  });

  it('is marked handled and back again; the new ones stay on top', async () => {
    t = await testApp();
    const admin = await root(t);
    await send(t, { ...REQUEST, school: 'Первая' });
    await send(t, { ...REQUEST, school: 'Вторая' });
    const [second] = await list(t, admin);
    expect(second?.school).toBe('Вторая');
    const mark = () =>
      t!.app.inject({
        method: 'POST',
        url: `/api/admin/pilot-requests/${second?.id ?? ''}/handled`,
        headers: { cookie: admin },
      });
    expect((await mark()).statusCode).toBe(200);
    const after = await list(t, admin);
    expect(after.map((r) => r.school)).toEqual(['Первая', 'Вторая']);
    expect(after[1]?.handledAt).not.toBeNull();
    await mark();
    expect((await list(t, admin))[0]?.handledAt).toBeNull();
  });

  it('refuses empty or overlong fields', async () => {
    t = await testApp();
    expect((await send(t, { ...REQUEST, school: '  ' })).statusCode).toBe(400);
    expect((await send(t, { ...REQUEST, contact: 'x'.repeat(121) })).statusCode).toBe(400);
    expect((await send(t, { ...REQUEST, classes: 0 })).statusCode).toBe(400);
    expect((await send(t, { ...REQUEST, extra: 1 })).statusCode).toBe(400);
  });

  it('keeps nothing from a robot and stops a flood from one address', async () => {
    t = await testApp();
    const admin = await root(t);
    expect((await send(t, { ...REQUEST, website: 'http://spam.example' })).statusCode).toBe(201);
    expect(await list(t, admin)).toHaveLength(0);

    for (let i = 0; i < 3; i += 1)
      expect((await send(t, REQUEST, '10.0.0.9')).statusCode).toBe(201);
    expect((await send(t, REQUEST, '10.0.0.9')).statusCode).toBe(429);
    // Another school is not punished for it.
    expect((await send(t, REQUEST, '10.0.0.10')).statusCode).toBe(201);
    expect(await list(t, admin)).toHaveLength(4);
  });

  it('is not taken by a classroom server', async () => {
    t = await testApp({ CLASSROOM_MODE: '1' });
    expect((await send(t, REQUEST)).statusCode).toBe(404);
  });
});
