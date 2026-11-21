import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResetLinkResponseSchema } from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { DEMO, ensureSuperadmin } from '../src/db/seed.js';
import { LogMailer } from '../src/services/mailer.js';
import {
  loginTeacher,
  registerTeacher,
  testApp,
  TEACHER_PASSWORD,
  type TestApp,
} from './helpers.js';

/** A7 (stage 5): a forgotten password — by mail, or a link from an administrator. */

let t: TestApp;
let mail: LogMailer;

beforeEach(async () => {
  mail = new LogMailer();
  t = await testApp({}, { mailer: mail });
});

afterEach(async () => {
  await t.close();
});

const forgot = (email: string) =>
  t.app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email } });
const reset = (token: string, password: string) =>
  t.app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token, password } });
const me = (cookie: string) => t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
const login = (password: string) =>
  t.app.inject({
    method: 'POST',
    url: '/api/auth/teacher',
    payload: { email: 'demo@sinf.local', password },
  });
const tokenOf = (url: string) => url.split('/teacher/reset/')[1] ?? '';

describe('a forgotten password by mail', () => {
  it('sends a link to a known address only, and says "sent" either way', async () => {
    expect((await forgot('nobody@example.com')).json()).toEqual({ ok: true });
    expect(mail.sent).toEqual([]);
    expect((await forgot('DEMO@sinf.local')).json()).toEqual({ ok: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'demo@sinf.local', subject: 'Sinf: новый пароль' });
    expect(mail.sent[0]?.text).toMatch(/http:\/\/localhost(:\d+)?\/teacher\/reset\/[\w-]{40,}/);
  });

  it('sets the new password once, signs in, and ends every older login', async () => {
    const before = await loginTeacher(t.app);
    await forgot('demo@sinf.local');
    const url = /(\S+\/teacher\/reset\/\S+)/.exec(mail.sent[0]?.text ?? '')?.[1] ?? '';
    const res = await reset(tokenOf(url), 'новый-пароль-1');
    expect(res.statusCode).toBe(200);
    const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
    expect((await me(`${jar?.name}=${jar?.value}`)).statusCode).toBe(200);
    // The laptop left logged in at school is logged out.
    expect((await me(before)).statusCode).toBe(401);
    expect((await login(TEACHER_PASSWORD)).statusCode).toBe(401);
    expect((await login('новый-пароль-1')).statusCode).toBe(200);
    // Once only.
    expect((await reset(tokenOf(url), 'ещё-один-1')).json<{ error: string }>().error).toBe(
      'reset_gone',
    );
  });

  it('refuses an old link, a superseded one and a weak password; mails at most three times', async () => {
    await forgot('demo@sinf.local');
    const first = tokenOf(/(\S+\/teacher\/reset\/\S+)/.exec(mail.sent[0]?.text ?? '')?.[1] ?? '');
    await forgot('demo@sinf.local');
    const second = tokenOf(/(\S+\/teacher\/reset\/\S+)/.exec(mail.sent[1]?.text ?? '')?.[1] ?? '');
    expect((await reset(first, 'новый-пароль-1')).statusCode).toBe(400);
    expect((await reset(second, 'short')).statusCode).toBe(400);
    t.database.db
      .update(schema.passwordResets)
      .set({ expiresAt: '2000-01-01T00:00:00.000Z' })
      .run();
    expect((await reset(second, 'новый-пароль-1')).statusCode).toBe(400);

    await forgot('demo@sinf.local');
    await forgot('demo@sinf.local');
    expect(mail.sent).toHaveLength(3);
  });

  it('keeps a login made before stage 5 (the cookie with the id alone)', async () => {
    const legacy = `sinf_teacher=${t.app.signCookie(DEMO.teacherId)}`;
    expect((await me(legacy)).statusCode).toBe(200);
  });
});

describe('a link from an administrator', () => {
  it('the school’s administrator gives one to a teacher of the school, nobody else', async () => {
    const admin = await loginTeacher(t.app);
    const other = await registerTeacher(t.app);
    const user = t.database.db
      .select()
      .from(schema.users)
      .all()
      .find((u) => u.email === 'second@example.com');
    const url = `/api/schools/${DEMO.schoolId}/members/${user?.id}/reset-link`;
    // Not of the school yet.
    expect(
      (await t.app.inject({ method: 'POST', url, headers: { cookie: admin } })).statusCode,
    ).toBe(404);
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: other },
    });
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests/${user?.id}`,
      headers: { cookie: admin },
      payload: { decision: 'approve' },
    });
    const res = await t.app.inject({ method: 'POST', url, headers: { cookie: admin } });
    const link = ResetLinkResponseSchema.parse(res.json());
    expect((await reset(tokenOf(link.url), 'от-завуча-1')).statusCode).toBe(200);
    // A plain teacher cannot give one.
    const back = `/api/schools/${DEMO.schoolId}/members/${DEMO.teacherId}/reset-link`;
    const jar = (
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/teacher',
        payload: { email: 'second@example.com', password: 'от-завуча-1' },
      })
    ).cookies.find((c) => c.name === 'sinf_teacher');
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: back,
          headers: { cookie: `${jar?.name}=${jar?.value}` },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('the superadmin gives one for any address', async () => {
    ensureSuperadmin(t.database.db, { email: 'root@sinf.uz', password: 'root-pass-1234' });
    const jar = (
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/teacher',
        payload: { email: 'root@sinf.uz', password: 'root-pass-1234' },
      })
    ).cookies.find((c) => c.name === 'sinf_teacher');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/reset-link',
      headers: { cookie: `${jar?.name}=${jar?.value}` },
      payload: { email: 'demo@sinf.local' },
    });
    expect(ResetLinkResponseSchema.parse(res.json()).url).toContain('/teacher/reset/');
    const admin = await loginTeacher(t.app);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/admin/reset-link',
          headers: { cookie: admin },
          payload: { email: 'demo@sinf.local' },
        })
      ).statusCode,
    ).toBe(404);
  });
});
