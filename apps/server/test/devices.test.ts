import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DeviceListResponseSchema,
  MeResponseSchema,
  DeviceSchema,
  DeviceStateResponseSchema,
  PairDeviceResponseSchema,
} from '@sinf/shared';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/**
 * S2.4: the school adds a computer, the app on it pairs with a code and reports in. An unpaired or
 * removed machine gets nothing.
 */

let t: TestApp;
/** The demo teacher is the administrator of the demo school. */
let admin: string;

const CreatedSchema = z.strictObject({ device: DeviceSchema });

beforeEach(async () => {
  t = await testApp();
  admin = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

async function addDevice(
  payload: Record<string, unknown> = { name: 'ПК-05', room: 'Кабинет 204' },
) {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/schools/${DEMO.schoolId}/devices`,
    headers: { cookie: admin },
    payload,
  });
  expect(res.statusCode).toBe(200);
  return CreatedSchema.parse(res.json()).device;
}

async function pair(code: string, appVersion = '0.1.0') {
  return t.app.inject({
    method: 'POST',
    url: '/api/devices/pair',
    payload: { code, appVersion, platform: 'Windows 11' },
  });
}

async function heartbeat(token: string, appVersion?: string) {
  return t.app.inject({
    method: 'POST',
    url: '/api/devices/heartbeat',
    headers: { authorization: `Device ${token}` },
    payload: appVersion ? { appVersion } : {},
  });
}

async function registerOutsider(): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { fullName: 'Чужой Учитель', email: 'outsider@example.com', password: 'parol12345' },
  });
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  if (!jar) throw new Error('no cookie');
  return `${jar.name}=${jar.value}`;
}

describe('adding a computer', () => {
  it('gives the administrator a code and shows the machine as waiting', async () => {
    const device = await addDevice();
    expect(device.paired).toBe(false);
    expect(device.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(device.room).toBe('Кабинет 204');

    const list = DeviceListResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/schools/${DEMO.schoolId}/devices`,
          headers: { cookie: admin },
        })
      ).json(),
    );
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]?.pairingCode).toBe(device.pairingCode);
  });

  it('hides the codes from a plain teacher of the school', async () => {
    await addDevice();
    const teacher = await registerOutsider();
    // Put the outsider in the school as a plain teacher.
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests`,
      headers: { cookie: teacher },
    });
    const me = MeResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: teacher } })).json(),
    );
    await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/requests/${me.teacher.id}`,
      headers: { cookie: admin },
      payload: { decision: 'approve' },
    });

    const list = DeviceListResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/schools/${DEMO.schoolId}/devices`,
          headers: { cookie: teacher },
        })
      ).json(),
    );
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]?.pairingCode).toBeNull();

    // And may not add or remove machines.
    const added = await t.app.inject({
      method: 'POST',
      url: `/api/schools/${DEMO.schoolId}/devices`,
      headers: { cookie: teacher },
      payload: { name: 'Свой ПК' },
    });
    expect(added.statusCode).toBe(404);
  });

  it('is invisible to a teacher of another school', async () => {
    const device = await addDevice();
    const outsider = await registerOutsider();
    for (const attempt of [
      { method: 'GET' as const, url: `/api/schools/${DEMO.schoolId}/devices` },
      { method: 'DELETE' as const, url: `/api/devices/${device.id}` },
      { method: 'POST' as const, url: `/api/devices/${device.id}/code` },
    ]) {
      const res = await t.app.inject({ ...attempt, headers: { cookie: outsider } });
      expect(`${attempt.url} → ${res.statusCode}`).toBe(`${attempt.url} → 404`);
    }
  });
});

describe('pairing the app', () => {
  it('trades the code for a token and the code stops working', async () => {
    const device = await addDevice();
    const res = await pair(device.pairingCode as string);
    expect(res.statusCode).toBe(200);
    const paired = PairDeviceResponseSchema.parse(res.json());
    expect(paired.deviceId).toBe(device.id);
    expect(paired.school).toMatchObject({ id: DEMO.schoolId, name: DEMO.schoolName });
    expect(paired.name).toBe('ПК-05');

    // The same code a second time: one code, one computer.
    const again = await pair(device.pairingCode as string);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ error: 'bad_code' });

    const list = DeviceListResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/schools/${DEMO.schoolId}/devices`,
          headers: { cookie: admin },
        })
      ).json(),
    );
    expect(list.devices[0]).toMatchObject({
      paired: true,
      pairingCode: null,
      appVersion: '0.1.0',
    });
    expect(list.devices[0]?.lastSeenAt).toBeTruthy();
  });

  it('refuses a made-up code', async () => {
    const res = await pair('ZZZZZZ');
    expect(res.statusCode).toBe(404);
  });

  it('refuses a code whose time has passed', async () => {
    const device = await addDevice();
    t.database.db.run(
      `UPDATE devices SET pairing_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = '${device.id}'`,
    );
    const res = await pair(device.pairingCode as string);
    expect(res.statusCode).toBe(404);
  });

  it('stops guessing after ten wrong codes', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await pair(`WRONG${i}`)).statusCode).toBe(404);
    }
    const device = await addDevice();
    const blocked = await pair(device.pairingCode as string);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'too_many_attempts' });
  });
});

describe('a paired computer', () => {
  async function pairedToken(): Promise<{ token: string; deviceId: string }> {
    const device = await addDevice();
    const paired = PairDeviceResponseSchema.parse(
      (await pair(device.pairingCode as string)).json(),
    );
    return { token: paired.deviceToken, deviceId: device.id };
  }

  it('reports in and the school sees when it was last on', async () => {
    const { token, deviceId } = await pairedToken();
    const res = await heartbeat(token, '0.2.0');
    expect(res.statusCode).toBe(200);
    const state = DeviceStateResponseSchema.parse(res.json());
    expect(state).toMatchObject({ deviceId, name: 'ПК-05', role: 'teacher' });
    expect(state.school.name).toBe(DEMO.schoolName);

    const list = DeviceListResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/schools/${DEMO.schoolId}/devices`,
          headers: { cookie: admin },
        })
      ).json(),
    );
    expect(list.devices[0]?.appVersion).toBe('0.2.0');
  });

  it('is refused without a token, with a made-up one and with somebody else token', async () => {
    const { token, deviceId } = await pairedToken();
    expect((await t.app.inject({ method: 'POST', url: '/api/devices/heartbeat' })).statusCode).toBe(
      401,
    );
    expect((await heartbeat('nonsense')).statusCode).toBe(401);
    expect((await heartbeat(`${deviceId}.not-the-right-token`)).statusCode).toBe(401);
    expect((await heartbeat(token)).statusCode).toBe(200);
  });

  it('goes silent once the school removes it', async () => {
    const { token, deviceId } = await pairedToken();
    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/api/devices/${deviceId}`,
      headers: { cookie: admin },
    });
    expect(removed.statusCode).toBe(200);
    expect(DeviceListResponseSchema.parse(removed.json()).devices).toEqual([]);
    expect((await heartbeat(token)).statusCode).toBe(401);
  });

  it('loses its token when the administrator issues a new code', async () => {
    const { token, deviceId } = await pairedToken();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/devices/${deviceId}/code`,
      headers: { cookie: admin },
    });
    expect(res.statusCode).toBe(200);
    const device = CreatedSchema.parse(res.json()).device;
    expect(device.paired).toBe(false);
    expect(device.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect((await heartbeat(token)).statusCode).toBe(401);

    // The new code works, and the machine is paired again.
    expect((await pair(device.pairingCode as string)).statusCode).toBe(200);
  });

  it('is renamed and moved to another room by the administrator', async () => {
    const { deviceId } = await pairedToken();
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/devices/${deviceId}`,
      headers: { cookie: admin },
      payload: { name: 'ПК-07', room: 'Кабинет 301', role: 'student' },
    });
    expect(res.statusCode).toBe(200);
    expect(CreatedSchema.parse(res.json()).device).toMatchObject({
      name: 'ПК-07',
      room: 'Кабинет 301',
      role: 'student',
      paired: true,
    });
  });
});
