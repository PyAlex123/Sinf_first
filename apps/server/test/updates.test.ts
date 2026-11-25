import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  AdminUpdatesResponseSchema,
  LatestUpdateResponseSchema,
  compareVersions,
  updateMessage,
  type UpdateManifest,
} from '@sinf/shared';
import { ensureSuperadmin } from '../src/db/seed.js';
import { UpdateMirror, latestUpdate, signatureValid, updatesDir } from '../src/services/updates.js';
import { loginTeacher, testApp, testConfig, type TestApp } from './helpers.js';

/** B6 (stage 6): signed updates of the Windows app — uploaded, handed out, copied to a classroom. */

const ROOT = { email: 'root@sinf.uz', password: 'root-pass-1234' };

const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUBLIC = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

function release(
  version: string,
  bytes = Buffer.from(`installer ${version}`),
  key: KeyObject = keys.privateKey,
): { manifest: UpdateManifest; bytes: Buffer } {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const base = { version, sha256, size: bytes.length };
  const signature = sign('sha256', Buffer.from(updateMessage(base)), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  return { manifest: { ...base, file: `Sinf-update-${version}.exe`, signature }, bytes };
}

/** A logger that says nothing. */
const silent = new Proxy({}, { get: () => () => undefined }) as FastifyBaseLogger;

let t: TestApp | null = null;
afterEach(async () => {
  if (t) {
    for (const id of t.app.sessions.liveSessionIds()) t.app.sessions.end(id);
    await t.close();
  }
  t = null;
});

async function root(app: TestApp): Promise<string> {
  ensureSuperadmin(app.database.db, ROOT);
  const res = await app.app.inject({ method: 'POST', url: '/api/auth/teacher', payload: ROOT });
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  return `${jar?.name}=${jar?.value}`;
}

function upload(app: TestApp, cookie: string, r: { manifest: UpdateManifest; bytes: Buffer }) {
  const { version, ...rest } = r.manifest;
  const query = new URLSearchParams({ ...rest, size: String(rest.size) }).toString();
  return app.app.inject({
    method: 'PUT',
    url: `/api/admin/updates/${version}?${query}`,
    headers: { cookie, 'content-type': 'application/octet-stream' },
    payload: r.bytes,
  });
}

describe('versions', () => {
  it('compare as numbers', () => {
    expect(compareVersions('0.3.112', '0.3.99')).toBe(1);
    expect(compareVersions('0.3.99', '0.3.112')).toBe(-1);
    expect(compareVersions('0.3.5', '0.3.5.0')).toBe(0);
    expect(compareVersions('0.3.5.1', '0.3.5')).toBe(1);
  });

  it('are signed over the version, the hash and the size', () => {
    const { manifest } = release('0.3.7');
    expect(signatureValid(manifest, PUBLIC)).toBe(true);
    expect(signatureValid({ ...manifest, version: '0.3.8' }, PUBLIC)).toBe(false);
    expect(signatureValid({ ...manifest, size: manifest.size + 1 }, PUBLIC)).toBe(false);
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(signatureValid(release('0.3.7', undefined, other.privateKey).manifest, PUBLIC)).toBe(
      false,
    );
    expect(signatureValid(manifest, 'not a key')).toBe(false);
  });
});

describe('the platform', () => {
  it('takes a signed update from the superadmin and hands it to any computer', async () => {
    t = await testApp({ UPDATE_PUBLIC_KEY: PUBLIC });
    const admin = await root(t);
    const empty = LatestUpdateResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/updates/latest' })).json(),
    );
    expect(empty).toEqual({ update: null, busy: false });

    const r = release('0.3.10', Buffer.alloc(300_000, 7));
    const res = await upload(t, admin, r);
    expect(res.statusCode, res.body).toBe(200);

    const latest = LatestUpdateResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/updates/latest' })).json(),
    );
    expect(latest.update).toEqual(r.manifest);
    // The platform is no classroom: never "busy", whatever web lessons are on.
    expect(latest.busy).toBe(false);

    const file = await t.app.inject({ method: 'GET', url: '/api/updates/0.3.10/installer' });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(r.bytes)).toBe(true);
    expect(file.headers['x-sinf-sha256']).toBe(r.manifest.sha256);

    const list = AdminUpdatesResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/admin/updates', headers: { cookie: admin } })
      ).json(),
    );
    expect(list.checksSignatures).toBe(true);
    expect(list.updates.map((u) => u.version)).toEqual(['0.3.10']);
  });

  it('refuses a file that is not what update.json says, or not signed by our key', async () => {
    t = await testApp({ UPDATE_PUBLIC_KEY: PUBLIC });
    const admin = await root(t);
    const r = release('0.3.11');
    const code = async (x: { manifest: UpdateManifest; bytes: Buffer }) =>
      (await upload(t as TestApp, admin, x)).json<{ error: string }>().error;

    const swapped = Buffer.from(r.bytes);
    swapped[0] = 0x58;
    expect(await code({ ...r, bytes: swapped })).toBe('bad_hash');
    expect(await code({ ...r, bytes: Buffer.concat([r.bytes, Buffer.from('x')]) })).toBe(
      'bad_size',
    );
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(await code(release('0.3.11', undefined, other.privateKey))).toBe('bad_signature');
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/updates/0.3.11/installer' })).statusCode,
    ).toBe(404);
    expect(await latestUpdate(updatesDir(t.config))).toBeNull();
  });

  it('is the superadmin’s alone; keeps the last two versions; deletes one', async () => {
    t = await testApp();
    const teacher = await loginTeacher(t.app);
    expect((await upload(t, teacher, release('0.3.1'))).statusCode).toBe(404);
    const admin = await root(t);
    for (const v of ['0.3.1', '0.3.3', '0.3.2']) {
      expect((await upload(t, admin, release(v))).statusCode).toBe(200);
    }
    // Without the key the platform cannot check signatures, and says so.
    const list = AdminUpdatesResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/admin/updates', headers: { cookie: admin } })
      ).json(),
    );
    expect(list.checksSignatures).toBe(false);
    expect(list.updates.map((u) => u.version)).toEqual(['0.3.3', '0.3.2']);
    expect(existsSync(join(updatesDir(t.config), '0.3.1'))).toBe(false);

    const removed = await t.app.inject({
      method: 'DELETE',
      url: '/api/admin/updates/0.3.3',
      headers: { cookie: admin },
    });
    expect(removed.statusCode).toBe(200);
    const latest = LatestUpdateResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/updates/latest' })).json(),
    );
    expect(latest.update?.version).toBe('0.3.2');
  });
});

describe('a classroom', () => {
  it('says "busy" while a lesson is on, so the computers wait', async () => {
    t = await testApp({ CLASSROOM_MODE: '1' });
    const cookie = await loginTeacher(t.app);
    const busy = async () =>
      LatestUpdateResponseSchema.parse(
        (await t!.app.inject({ method: 'GET', url: '/api/updates/latest' })).json(),
      ).busy;
    expect(await busy()).toBe(false);
    const started = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: 'class-1a', lessonId: 'g10' },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(await busy()).toBe(true);
    const { session } = started.json<{ session: { id: string } }>();
    await t.app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/end`,
      headers: { cookie },
    });
    expect(await busy()).toBe(false);
  });

  it('copies the platform’s newest update once, checking it on the way', async () => {
    const config = testConfig({ UPDATE_PUBLIC_KEY: PUBLIC });
    const r = release('0.3.20', Buffer.alloc(50_000, 3));
    let downloads = 0;
    const urlOf = (input: Parameters<typeof fetch>[0]): string =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const platform: typeof fetch = (input) => {
      const url = urlOf(input);
      if (url.endsWith('/api/updates/latest')) {
        return Promise.resolve(Response.json({ update: r.manifest, busy: false }));
      }
      if (url.endsWith('/api/updates/0.3.20/installer')) {
        downloads += 1;
        return Promise.resolve(new Response(new Uint8Array(r.bytes)));
      }
      return Promise.resolve(new Response('no', { status: 404 }));
    };
    const mirror = new UpdateMirror(config, silent, platform);
    const link = { url: 'https://sinf.example', deviceToken: 'token' };
    expect((await mirror.mirror(link))?.version).toBe('0.3.20');
    expect(await mirror.mirror(link)).toBeNull();
    expect(downloads).toBe(1);
    expect((await latestUpdate(updatesDir(config)))?.sha256).toBe(r.manifest.sha256);

    // A forged installer on the way is not kept.
    const forged = new UpdateMirror(testConfig({ UPDATE_PUBLIC_KEY: PUBLIC }), silent, (input) =>
      Promise.resolve(
        urlOf(input).endsWith('/latest')
          ? Response.json({ update: release('0.3.21').manifest, busy: false })
          : new Response('evil bytes'),
      ),
    );
    expect(await forged.mirror(link)).toBeNull();
  });
});
