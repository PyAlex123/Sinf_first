import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentManifestSchema, DeviceSchema, PairDeviceResponseSchema } from '@sinf/shared';
import { z } from 'zod';
import { REPO_ROOT } from '../src/config.js';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/**
 * S2.5: a school computer asks what lesson material exists and fetches what it lacks. Everything here
 * goes through the single access point that a licence check will later sit in (ADR-009).
 */

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

const manifest = async (headers: Record<string, string>) =>
  t.app.inject({ method: 'GET', url: '/api/content/manifest', headers });

/** Adds a computer to the demo school and pairs it, the way the app does (S2.4). */
async function pairedDevice(): Promise<string> {
  const created = await t.app.inject({
    method: 'POST',
    url: `/api/schools/${DEMO.schoolId}/devices`,
    headers: { cookie },
    payload: { name: 'ПК-05' },
  });
  const device = z.strictObject({ device: DeviceSchema }).parse(created.json()).device;
  const paired = await t.app.inject({
    method: 'POST',
    url: '/api/devices/pair',
    payload: { code: device.pairingCode, appVersion: '0.1.0' },
  });
  return PairDeviceResponseSchema.parse(paired.json()).deviceToken;
}

describe('the manifest', () => {
  it('lists the real files of the course with hashes that match the disk', async () => {
    const res = await manifest({ cookie });
    expect(res.statusCode).toBe(200);
    const body = ContentManifestSchema.parse(res.json());
    expect(body.courses.map((c) => c.id)).toEqual(['1-klass-2-chetvert', 'proba-praktiki']);

    const course = body.courses[0];
    if (!course) throw new Error('no course');
    expect(course.id).toBe('1-klass-2-chetvert');
    expect(course.version).toMatch(/^[0-9a-f]{16}$/);
    expect(body.totalBytes).toBeGreaterThan(1_000_000);

    const paths = course.files.map((f) => f.path);
    expect(paths).toContain('1-klass-2-chetvert/course.json');
    expect(paths).toContain('1-klass-2-chetvert/lessons/g10.json');
    expect(paths).toContain('1-klass-2-chetvert/pics.json');
    expect(paths.filter((p) => p.includes('/media/')).length).toBeGreaterThan(100);
    // Paths always travel with forward slashes, so Windows gets what it expects.
    expect(paths.every((p) => !p.includes('\\'))).toBe(true);

    // Three files is enough to prove the hashes are of the bytes on disk.
    for (const file of [course.files[0], course.files[1], course.files.at(-1)]) {
      if (!file) throw new Error('no file');
      const bytes = readFileSync(join(REPO_ROOT, 'content', ...file.path.split(posix.sep)));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      expect(bytes.length).toBe(file.size);
    }
  });

  it('does not change from one request to the next', async () => {
    const first = ContentManifestSchema.parse((await manifest({ cookie })).json());
    const second = ContentManifestSchema.parse((await manifest({ cookie })).json());
    expect(second).toEqual(first);
  });
});

describe('fetching a file', () => {
  it('gives back exactly what lies in content/', async () => {
    const body = ContentManifestSchema.parse((await manifest({ cookie })).json());
    const file = body.courses[0]?.files.find((f) => f.path.endsWith('course.json'));
    if (!file) throw new Error('no course.json');

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/content/file?path=${encodeURIComponent(file.path)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sinf-sha256']).toBe(file.sha256);
    const onDisk = readFileSync(join(REPO_ROOT, 'content', ...file.path.split(posix.sep)));
    expect(res.rawPayload.equals(onDisk)).toBe(true);
  });

  it('serves nothing that is not in the manifest', async () => {
    for (const path of [
      '../.env',
      '1-klass-2-chetvert/../../package.json',
      '1-klass-2-chetvert/lessons/nope.json',
      '/etc/passwd',
      '1-klass-2-chetvert/.manifest.json',
    ]) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/content/file?path=${encodeURIComponent(path)}`,
        headers: { cookie },
      });
      expect(`${path} → ${res.statusCode}`).toBe(`${path} → 404`);
    }
  });
});

describe('who may download the material', () => {
  it('asks a stranger to log in or pair first', async () => {
    expect((await manifest({})).statusCode).toBe(401);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/content/file?path=whatever' })).statusCode,
    ).toBe(401);
  });

  it('lets a paired school computer in with its own token', async () => {
    const token = await pairedDevice();
    const res = await manifest({ authorization: `Device ${token}` });
    expect(res.statusCode).toBe(200);
    expect(ContentManifestSchema.parse(res.json()).courses).toHaveLength(2);
  });

  it('shuts the door on a computer the school unpaired', async () => {
    const token = await pairedDevice();
    const deviceId = token.split('.')[0] as string;
    await t.app.inject({ method: 'DELETE', url: `/api/devices/${deviceId}`, headers: { cookie } });
    expect((await manifest({ authorization: `Device ${token}` })).statusCode).toBe(401);
  });

  it('refuses a made-up token', async () => {
    expect((await manifest({ authorization: 'Device nonsense' })).statusCode).toBe(401);
    expect((await manifest({ authorization: 'Bearer something' })).statusCode).toBe(401);
  });
});
