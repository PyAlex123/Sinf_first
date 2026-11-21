import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CreatedInviteResponseSchema,
  InviteAcceptResponseSchema,
  InviteInfoResponseSchema,
  MeResponseSchema,
  SchoolInvitesResponseSchema,
} from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, registerTeacher, testApp, type TestApp } from './helpers.js';

/** A6 (stage 5): a teacher comes into a school by a link. */

let t: TestApp;
let admin: string;

beforeEach(async () => {
  t = await testApp();
  admin = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

const base = `/api/schools/${DEMO.schoolId}/invites`;

async function makeLink(): Promise<string> {
  const res = await t.app.inject({ method: 'POST', url: base, headers: { cookie: admin } });
  expect(res.statusCode).toBe(200);
  return CreatedInviteResponseSchema.parse(res.json()).token;
}

describe('a link into the school', () => {
  it('lets teachers in at once, many of them, and counts them', async () => {
    const token = await makeLink();
    // Anybody may see where it leads.
    const info = await t.app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(InviteInfoResponseSchema.parse(info.json())).toMatchObject({
      school: { id: DEMO.schoolId },
      visitor: 'guest',
    });
    const asAdmin = await t.app.inject({
      method: 'GET',
      url: `/api/invites/${token}`,
      headers: { cookie: admin },
    });
    expect(InviteInfoResponseSchema.parse(asAdmin.json()).visitor).toBe('member');

    for (const email of ['one@example.com', 'two@example.com']) {
      const cookie = await registerTeacher(t.app, email);
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/invites/${token}/accept`,
        headers: { cookie },
      });
      expect(InviteAcceptResponseSchema.parse(res.json())).toEqual({
        schoolId: DEMO.schoolId,
        already: false,
      });
      const me = MeResponseSchema.parse(
        (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json(),
      );
      expect(me.schools).toMatchObject([{ id: DEMO.schoolId, role: 'teacher' }]);
      // Twice is harmless.
      const again = await t.app.inject({
        method: 'POST',
        url: `/api/invites/${token}/accept`,
        headers: { cookie },
      });
      expect(InviteAcceptResponseSchema.parse(again.json()).already).toBe(true);
    }
    const list = SchoolInvitesResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: base, headers: { cookie: admin } })).json(),
    );
    expect(list.invites).toMatchObject([{ used: 2, createdByName: 'Демо Учитель' }]);
    // Only a hash of the secret is kept.
    const row = t.database.db.select().from(schema.schoolInvites).get();
    expect(row?.tokenHash).not.toContain(token);
  });

  it('answers a request the teacher made before', async () => {
    const cookie = await registerTeacher(t.app);
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie },
    });
    const token = await makeLink();
    await t.app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: { cookie },
    });
    const me = MeResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json(),
    );
    expect(me.pendingSchool).toBeNull();
  });

  it('stops working when revoked or old, and is the administrator’s to make', async () => {
    const token = await makeLink();
    const list = SchoolInvitesResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: base, headers: { cookie: admin } })).json(),
    );
    const id = list.invites[0]?.id ?? '';
    const gone = SchoolInvitesResponseSchema.parse(
      (
        await t.app.inject({ method: 'DELETE', url: `${base}/${id}`, headers: { cookie: admin } })
      ).json(),
    );
    expect(gone.invites).toEqual([]);
    const after = await t.app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect([after.statusCode, after.json<{ error: string }>().error]).toEqual([404, 'invite_gone']);

    const old = await makeLink();
    t.database.db.update(schema.schoolInvites).set({ expiresAt: '2000-01-01T00:00:00.000Z' }).run();
    const cookie = await registerTeacher(t.app);
    const late = await t.app.inject({
      method: 'POST',
      url: `/api/invites/${old}/accept`,
      headers: { cookie },
    });
    expect(late.statusCode).toBe(404);

    // A plain teacher cannot make one.
    expect(
      (await t.app.inject({ method: 'POST', url: base, headers: { cookie } })).statusCode,
    ).toBe(404);
  });
});
