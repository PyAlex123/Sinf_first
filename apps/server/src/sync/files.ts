import { readFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  fileNameKey,
  FileUploadResponseSchema,
  SyncedFilesResponseSchema,
  type SyncedFilesResponse,
} from '@sinf/shared';
import type { PlatformLink } from '../config.js';
import { schema, type Db } from '../db/index.js';
import { blobPath, collect, receiveBlob } from '../services/student-files.js';

/**
 * "Мои работы" between a school computer and the platform (H12, ADR-015).
 *
 * The platform holds the true folder; the teacher's computer holds a working copy for its lessons.
 * Nothing is decided by clocks: every change carries the content it was made from (`cloudSha`), and
 * the platform keeps both versions when two places changed the same file (ADR-002, §5.3).
 *
 * - Up: files this computer changed (`dirty`) go to the platform each tick; a deletion is a row
 *   without content until the platform has heard of it.
 * - Down: when a child logs into a lesson here, their folder is fetched from the platform (if there
 *   is a connection), so the work done at home is there for the lesson.
 */

type FileRow = typeof schema.studentFiles.$inferSelect;

const auth = (link: PlatformLink) => ({ authorization: `Device ${link.deviceToken}` });

/** Sends this computer's changes. Returns how many the platform took; throws when offline. */
export async function pushFiles(
  db: Db,
  dataDir: string,
  link: PlatformLink,
  fetchImpl: typeof fetch,
  log: FastifyBaseLogger,
  limit = 20,
): Promise<number> {
  const dirty = db
    .select()
    .from(schema.studentFiles)
    .where(eq(schema.studentFiles.dirty, true))
    .orderBy(schema.studentFiles.updatedAt)
    .limit(limit)
    .all();
  let sent = 0;
  for (const row of dirty) {
    const base = row.cloudSha ? `&base=${row.cloudSha}` : '';
    const where = `${link.url}/api/sync/files/${encodeURIComponent(row.studentId)}?name=${encodeURIComponent(row.name)}${base}`;

    if (row.deletedAt) {
      const response = await fetchImpl(where, { method: 'DELETE', headers: auth(link) });
      // Gone there too, never there, or changed there meanwhile (it will come back on the next
      // pull): either way this computer has nothing more to say about it.
      if (response.ok || response.status === 404 || response.status === 409) {
        db.delete(schema.studentFiles).where(eq(schema.studentFiles.id, row.id)).run();
        sent += 1;
        continue;
      }
      break;
    }

    if (!row.sha256) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(blobPath(dataDir, row.sha256));
    } catch {
      // The bytes are gone from this computer; nothing can be sent for this version.
      db.update(schema.studentFiles)
        .set({ dirty: false })
        .where(eq(schema.studentFiles.id, row.id))
        .run();
      continue;
    }
    const response = await fetchImpl(`${where}&origin=${encodeURIComponent(row.origin)}`, {
      method: 'PUT',
      headers: { ...auth(link), 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      if ([400, 404, 413].includes(response.status)) {
        // The platform will never take this one (a name or a size it refuses, a child it does
        // not know); it must not block the rest.
        db.update(schema.studentFiles)
          .set({ dirty: false })
          .where(eq(schema.studentFiles.id, row.id))
          .run();
        log.warn({ fileId: row.id, status: response.status }, 'student file refused by platform');
        continue;
      }
      break;
    }
    const result = FileUploadResponseSchema.parse(await response.json());
    // Still the version that was sent? A save during the request makes the row dirty again.
    const now = db
      .select()
      .from(schema.studentFiles)
      .where(eq(schema.studentFiles.id, row.id))
      .get();
    if (now?.sha256 !== row.sha256) continue;
    if (result.conflictWith) {
      // The platform had another version under this name and kept ours as a copy: follow it, and
      // the next pull brings the platform's version of the original name.
      db.update(schema.studentFiles)
        .set({
          name: result.file.name,
          nameKey: fileNameKey(result.file.name),
          cloudSha: result.file.sha256,
          dirty: false,
        })
        .where(eq(schema.studentFiles.id, row.id))
        .run();
    } else {
      db.update(schema.studentFiles)
        .set({ cloudSha: result.file.sha256, dirty: false })
        .where(eq(schema.studentFiles.id, row.id))
        .run();
    }
    sent += 1;
  }
  return sent;
}

/**
 * Brings a child's folder from the platform. Local changes not yet sent are left alone: the push
 * settles them. Returns how many files changed here; throws when offline.
 */
export async function pullFiles(
  db: Db,
  dataDir: string,
  link: PlatformLink,
  fetchImpl: typeof fetch,
  studentId: string,
): Promise<number> {
  const response = await fetchImpl(`${link.url}/api/sync/files/${encodeURIComponent(studentId)}`, {
    headers: auth(link),
  });
  if (!response.ok) return 0;
  const cloud: SyncedFilesResponse = SyncedFilesResponseSchema.parse(await response.json());
  const local = db
    .select()
    .from(schema.studentFiles)
    .where(eq(schema.studentFiles.studentId, studentId))
    .all();
  const byKey = new Map<string, FileRow>(local.map((r) => [r.nameKey, r]));
  let changed = 0;
  const seen = new Set<string>();

  for (const file of cloud.files) {
    if (file.deleted || !file.sha256) continue;
    const key = fileNameKey(file.name);
    seen.add(key);
    const mine = byKey.get(key);
    if (mine?.dirty) continue;
    if (mine && mine.sha256 === file.sha256) {
      if (mine.cloudSha !== file.sha256) {
        db.update(schema.studentFiles)
          .set({ cloudSha: file.sha256 })
          .where(eq(schema.studentFiles.id, mine.id))
          .run();
      }
      continue;
    }
    const blob = await fetchImpl(
      `${link.url}/api/sync/files/${encodeURIComponent(studentId)}/blob/${file.sha256}`,
      { headers: auth(link) },
    );
    if (!blob.ok || !blob.body) continue;
    const { sha } = await receiveBlob(dataDir, Readable.fromWeb(blob.body), file.size);
    if (sha !== file.sha256) {
      collect(db, dataDir, sha);
      continue;
    }
    const at = file.updatedAt;
    if (mine) {
      const old = mine.sha256;
      db.update(schema.studentFiles)
        .set({
          name: file.name,
          size: file.size,
          sha256: sha,
          updatedAt: at,
          origin: 'облако',
          deletedAt: null,
          cloudSha: sha,
          dirty: false,
        })
        .where(eq(schema.studentFiles.id, mine.id))
        .run();
      collect(db, dataDir, old);
    } else {
      db.insert(schema.studentFiles)
        .values({
          id: crypto.randomUUID(),
          studentId,
          name: file.name,
          nameKey: key,
          size: file.size,
          sha256: sha,
          updatedAt: at,
          origin: 'облако',
          cloudSha: sha,
          dirty: false,
        })
        .run();
    }
    changed += 1;
  }

  // What the platform no longer has, and this computer has not changed since: deleted elsewhere.
  for (const mine of local) {
    if (seen.has(mine.nameKey) || mine.dirty || !mine.cloudSha) continue;
    db.delete(schema.studentFiles).where(eq(schema.studentFiles.id, mine.id)).run();
    collect(db, dataDir, mine.sha256);
    changed += 1;
  }
  return changed;
}

/** How many changes wait for the platform: for the teacher's sync box. */
export function countDirtyFiles(db: Db): number {
  return db
    .select({ id: schema.studentFiles.id })
    .from(schema.studentFiles)
    .where(and(eq(schema.studentFiles.dirty, true), isNotNull(schema.studentFiles.updatedAt)))
    .all().length;
}

/** Removes leftovers of an interrupted upload; called at start. */
export async function clearUploadLeftovers(dataDir: string): Promise<void> {
  await rm(`${dataDir}/files/tmp`, { recursive: true, force: true });
}
