import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  compareVersions,
  LatestUpdateResponseSchema,
  MAX_UPDATE_BYTES,
  StoredUpdateSchema,
  updateMessage,
  UpdateManifestSchema,
  type StoredUpdate,
  type UpdateManifest,
} from '@sinf/shared';
import type { Config, PlatformLink } from '../config.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

/**
 * Updates of the Windows app on disk (B6, ADR-023): `<data>/updates/<version>/` holds the installer
 * and its `update.json`. The platform gets them from the superadmin; a teacher's computer copies
 * the newest one from the platform, so the classroom downloads it once and the student computers
 * take it over the local network.
 *
 * The signature is what the computers trust, not this server: the updater checks it with the key
 * built into it. The server checks the size and the hash always, and the signature when it knows
 * the public key — a broken upload is refused here rather than on thirty computers.
 */

/** Versions kept: the newest and the one before, for a computer that is a step behind. */
const KEEP = 2;
/** A lesson that has not ended after this long was abandoned, not held. */
const LESSON_HOURS = 3;

export const updatesDir = (config: Config): string => join(config.dataDir, 'updates');

/** Signature over the version, hash and size — with the public key in base64 SPKI. */
export function signatureValid(manifest: UpdateManifest, publicKey: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      'sha256',
      Buffer.from(updateMessage(manifest)),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(manifest.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export async function listUpdates(dir: string): Promise<StoredUpdate[]> {
  if (!existsSync(dir)) return [];
  const found: StoredUpdate[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const stored = StoredUpdateSchema.parse(
        JSON.parse(await readFile(join(dir, entry.name, 'update.json'), 'utf8')),
      );
      const file = await stat(join(dir, entry.name, stored.file));
      if (stored.version === entry.name && file.size === stored.size) found.push(stored);
    } catch {
      // Half written or damaged: not offered.
    }
  }
  return found.sort((a, b) => compareVersions(b.version, a.version));
}

export const latestUpdate = async (dir: string): Promise<StoredUpdate | null> =>
  (await listUpdates(dir))[0] ?? null;

export function installerPath(dir: string, update: StoredUpdate): string {
  return join(dir, update.version, update.file);
}

/** A lesson is on here: on a classroom server its computers wait. The platform is never "busy". */
export function lessonOn(db: Db, config: Config, link: PlatformLink | null): boolean {
  if (!config.classroom && !link) return false;
  const since = new Date(Date.now() - LESSON_HOURS * 3600_000).toISOString();
  return !!db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.status, 'active'), gt(schema.sessions.startedAt, since)))
    .get();
}

/**
 * Writes the installer from a stream and keeps it only if it is exactly what the manifest says:
 * the size, the SHA-256 and — with a key — the signature. Older versions beyond the last two go.
 */
export async function storeUpdate(
  dir: string,
  manifest: UpdateManifest,
  body: Readable,
  publicKey: string | null,
): Promise<StoredUpdate> {
  if (publicKey && !signatureValid(manifest, publicKey)) {
    throw new ApiHttpError(400, 'bad_signature', 'The signature does not match the key');
  }
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.upload-${randomUUID()}`);
  await mkdir(temp);
  const hash = createHash('sha256');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, next) {
      size += chunk.length;
      // Breaking off the upload would cut the connection before the answer; only a stream far
      // beyond any installer is stopped, the rest is read to the end and refused there.
      if (size > MAX_UPDATE_BYTES) {
        next(new ApiHttpError(400, 'bad_size', 'The file is larger than an update can be'));
        return;
      }
      hash.update(chunk);
      next(null, size <= manifest.size ? chunk : undefined);
    },
  });
  try {
    await pipeline(body, counter, createWriteStream(join(temp, manifest.file)));
    if (size !== manifest.size) {
      throw new ApiHttpError(400, 'bad_size', 'The file is not the size update.json says');
    }
    if (hash.digest('hex') !== manifest.sha256) {
      throw new ApiHttpError(400, 'bad_hash', 'The file is not the one update.json describes');
    }
    const stored: StoredUpdate = { ...manifest, storedAt: new Date().toISOString() };
    await writeFile(join(temp, 'update.json'), JSON.stringify(stored, null, 2));
    const target = join(dir, manifest.version);
    await rm(target, { recursive: true, force: true });
    await rename(temp, target);
    for (const old of (await listUpdates(dir)).slice(KEEP)) {
      await rm(join(dir, old.version), { recursive: true, force: true });
    }
    return stored;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function removeUpdate(dir: string, version: string): Promise<boolean> {
  const target = join(dir, version);
  if (!existsSync(join(target, 'update.json'))) return false;
  await rm(target, { recursive: true, force: true });
  return true;
}

/**
 * The teacher's computer copies the platform's newest update for its classroom (B6). Called by the
 * sync worker; quiet when offline, and one download at a time.
 */
export class UpdateMirror {
  private running = false;

  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async mirror(link: PlatformLink): Promise<StoredUpdate | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const dir = updatesDir(this.config);
      const response = await this.fetchImpl(`${link.url}/api/updates/latest`, {
        headers: { authorization: `Device ${link.deviceToken}` },
      });
      if (!response.ok) return null;
      const { update } = LatestUpdateResponseSchema.parse(await response.json());
      if (!update) return null;
      const have = await latestUpdate(dir);
      if (have && compareVersions(have.version, update.version) >= 0) return null;
      const file = await this.fetchImpl(
        `${link.url}/api/updates/${encodeURIComponent(update.version)}/installer`,
        { headers: { authorization: `Device ${link.deviceToken}` } },
      );
      if (!file.ok || !file.body) return null;
      const stored = await storeUpdate(
        dir,
        UpdateManifestSchema.parse(update),
        Readable.fromWeb(file.body as WebReadableStream<Uint8Array>),
        this.config.updatePublicKey,
      );
      this.log.info({ version: stored.version }, 'update copied for the classroom');
      return stored;
    } catch (error) {
      this.log.debug({ err: error }, 'update mirror: nothing this time');
      return null;
    } finally {
      this.running = false;
    }
  }
}
