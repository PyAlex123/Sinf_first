import { createHash, randomInt, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  conflictName,
  FILE_QUOTA_BYTES,
  fileNameKey,
  MAX_FILE_BYTES,
  normalizeFileName,
  type FileUploadResponse,
  type StudentFile,
  type StudentFilesResponse,
} from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';

/**
 * "Мои работы" on the lesson server (CLAUDE.md §4.9; stage 3, H12; ADR-015).
 *
 * The bytes of every file are kept once per content, under their SHA-256 in `DATA_DIR/files`; the
 * `student_files` rows give them names in the children's folders. A name never becomes a path on
 * this computer, so no file name can reach outside the folder.
 *
 * Uploads arrive as a stream and go to a temporary file while being counted and hashed: a 50 MB
 * drawing never sits in memory, and thirty children saving at once do not fill it.
 */

type FileRow = typeof schema.studentFiles.$inferSelect;

/** At most this many uploads are written at once; the rest wait (an HDD prefers a queue). */
const PARALLEL_UPLOADS = 3;

export class UploadGate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= PARALLEL_UPLOADS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export function blobPath(dataDir: string, sha: string): string {
  return join(dataDir, 'files', sha.slice(0, 2), sha);
}

function toFile(row: FileRow): StudentFile {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    sha256: row.sha256 ?? '',
    updatedAt: row.updatedAt,
    origin: row.origin,
  };
}

const live = (studentId: string) =>
  and(eq(schema.studentFiles.studentId, studentId), isNull(schema.studentFiles.deletedAt));

export function usedBytes(db: Db, studentId: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${schema.studentFiles.size}), 0)` })
    .from(schema.studentFiles)
    .where(live(studentId))
    .get();
  return Number(row?.total ?? 0);
}

export function listFiles(
  db: Db,
  student: { id: string; firstName: string; lastName: string },
): StudentFilesResponse {
  const rows = db
    .select()
    .from(schema.studentFiles)
    .where(live(student.id))
    .orderBy(schema.studentFiles.nameKey)
    .all();
  return {
    student: { id: student.id, name: `${student.lastName} ${student.firstName}` },
    files: rows.map(toFile),
    usedBytes: rows.reduce((sum, r) => sum + r.size, 0),
    quotaBytes: FILE_QUOTA_BYTES,
  };
}

export function findFile(db: Db, studentId: string, fileId: string): FileRow {
  const row = db
    .select()
    .from(schema.studentFiles)
    .where(and(eq(schema.studentFiles.id, fileId), live(studentId)))
    .get();
  if (!row?.sha256) throw notFound('File');
  return row;
}

/** Drops the bytes of a content nobody names any more. */
export function collect(db: Db, dataDir: string, sha: string | null): void {
  if (!sha) return;
  const still = db
    .select({ id: schema.studentFiles.id })
    .from(schema.studentFiles)
    .where(eq(schema.studentFiles.sha256, sha))
    .get();
  if (!still) rmSync(blobPath(dataDir, sha), { force: true });
}

/**
 * Receives the bytes into the store and returns their hash. The declared length is the limit: a
 * body longer than it, or than a file may be, is cut off and refused.
 */
export async function receiveBlob(
  dataDir: string,
  body: Readable,
  declared: number,
): Promise<{ sha: string; size: number }> {
  const tmpDir = join(dataDir, 'files', 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmp = join(tmpDir, randomUUID());
  const hash = createHash('sha256');
  let size = 0;
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > declared || size > MAX_FILE_BYTES) {
        done(new ApiHttpError(413, 'too_large', 'The file is longer than it said'));
        return;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(body, count, createWriteStream(tmp));
  } catch (error) {
    rmSync(tmp, { force: true });
    if (error instanceof ApiHttpError) throw error;
    throw new ApiHttpError(400, 'upload_broken', 'The upload did not arrive whole');
  }
  if (size !== declared) {
    rmSync(tmp, { force: true });
    throw new ApiHttpError(400, 'upload_broken', 'The upload did not arrive whole');
  }
  const sha = hash.digest('hex');
  const target = blobPath(dataDir, sha);
  if (existsSync(target)) {
    rmSync(tmp, { force: true });
  } else {
    mkdirSync(join(dataDir, 'files', sha.slice(0, 2)), { recursive: true });
    renameSync(tmp, target);
  }
  return { sha, size };
}

export interface UploadInput {
  studentId: string;
  rawName: string;
  /** The content this version was made from; null for a file the uploader believes is new. */
  baseSha: string | null;
  /** "ПК-05", "браузер", "облако". */
  origin: string;
  body: Readable;
  declaredSize: number;
  /** A school computer marks local changes for the platform (ADR-011). */
  trackChanges: boolean;
}

/** The checks that need no bytes: name, size, room left. Done before anything is read. */
export function checkUpload(
  db: Db,
  input: Pick<UploadInput, 'studentId' | 'rawName' | 'declaredSize'>,
): string {
  const named = normalizeFileName(input.rawName);
  if (!named.ok)
    throw new ApiHttpError(400, `bad_name_${named.problem}`, 'This file name is not allowed');
  if (!Number.isInteger(input.declaredSize) || input.declaredSize < 0) {
    throw new ApiHttpError(411, 'length_required', 'Say how long the file is');
  }
  if (input.declaredSize > MAX_FILE_BYTES) {
    throw new ApiHttpError(413, 'too_large', 'A file may be at most 50 MB');
  }
  const current = db
    .select({ size: schema.studentFiles.size })
    .from(schema.studentFiles)
    .where(and(live(input.studentId), eq(schema.studentFiles.nameKey, fileNameKey(named.name))))
    .get();
  if (
    usedBytes(db, input.studentId) - (current?.size ?? 0) + input.declaredSize >
    FILE_QUOTA_BYTES
  ) {
    throw new ApiHttpError(413, 'quota', 'The folder is full');
  }
  return named.name;
}

/**
 * Stores a file in a child's folder. Three outcomes, decided by content, never by clock:
 * - the same content is already there — nothing changes;
 * - the upload was made from what is there now (`baseSha`), or the name is free — it takes the name;
 * - otherwise somebody changed the file meanwhile (two computers, school and home) — both are kept,
 *   the upload under "name (копия ПК-05)" (ADR-002, §5.3).
 */
export async function storeUpload(
  db: Db,
  dataDir: string,
  input: UploadInput,
  now = new Date(),
): Promise<FileUploadResponse> {
  const name = checkUpload(db, input);
  const { sha, size } = await receiveBlob(dataDir, input.body, input.declaredSize);
  const at = now.toISOString();

  const rowFor = (key: string) =>
    db
      .select()
      .from(schema.studentFiles)
      .where(
        and(
          eq(schema.studentFiles.studentId, input.studentId),
          eq(schema.studentFiles.nameKey, key),
        ),
      )
      .get();

  let replaced: string | null = null;
  const result = db.transaction((tx): FileUploadResponse => {
    const existing = rowFor(fileNameKey(name));
    const alive = existing && !existing.deletedAt ? existing : undefined;
    if (alive?.sha256 === sha) {
      return { file: toFile(alive), conflictWith: null, unchanged: true };
    }
    replaced = alive?.sha256 ?? null;
    if (!alive || alive.sha256 === input.baseSha) {
      if (existing) {
        tx.update(schema.studentFiles)
          .set({
            name,
            size,
            sha256: sha,
            updatedAt: at,
            origin: input.origin,
            deletedAt: null,
            dirty: input.trackChanges,
          })
          .where(eq(schema.studentFiles.id, existing.id))
          .run();
        return {
          file: toFile({
            ...existing,
            name,
            size,
            sha256: sha,
            updatedAt: at,
            origin: input.origin,
          }),
          conflictWith: null,
          unchanged: false,
        };
      }
      const row: FileRow = {
        id: randomUUID(),
        studentId: input.studentId,
        name,
        nameKey: fileNameKey(name),
        size,
        sha256: sha,
        updatedAt: at,
        origin: input.origin,
        deletedAt: null,
        cloudSha: null,
        dirty: input.trackChanges,
      };
      tx.insert(schema.studentFiles).values(row).run();
      return { file: toFile(row), conflictWith: null, unchanged: false };
    }
    // Somebody changed it meanwhile: keep theirs, put this one beside it.
    let n = 1;
    let copy = conflictName(name, input.origin);
    while (rowFor(fileNameKey(copy)) && n < 100) {
      n += 1;
      copy = conflictName(name, input.origin, n);
    }
    const row: FileRow = {
      id: randomUUID(),
      studentId: input.studentId,
      name: copy,
      nameKey: fileNameKey(copy),
      size,
      sha256: sha,
      updatedAt: at,
      origin: input.origin,
      deletedAt: null,
      cloudSha: null,
      dirty: input.trackChanges,
    };
    replaced = null;
    tx.insert(schema.studentFiles).values(row).run();
    return { file: toFile(row), conflictWith: alive.name, unchanged: false };
  });
  // A replaced content may have been the last one with these bytes; and an unchanged upload left
  // its bytes in the store only if somebody else already had them.
  collect(db, dataDir, replaced);
  if (result.unchanged) collect(db, dataDir, sha);
  return result;
}

/**
 * Deletes a file. A school computer keeps a row without content until the platform has heard of
 * it (`trackChanges`); the platform forgets the row at once.
 */
export function deleteFile(
  db: Db,
  dataDir: string,
  studentId: string,
  fileId: string,
  trackChanges: boolean,
  now = new Date(),
): void {
  const row = findFile(db, studentId, fileId);
  if (trackChanges && row.cloudSha) {
    db.update(schema.studentFiles)
      .set({ deletedAt: now.toISOString(), sha256: null, size: 0, dirty: true })
      .where(eq(schema.studentFiles.id, row.id))
      .run();
  } else {
    db.delete(schema.studentFiles).where(eq(schema.studentFiles.id, row.id)).run();
  }
  collect(db, dataDir, row.sha256);
}

// ---------- the class code a child types at home

/** Gives every class without one a six-digit code; only the platform makes them (H12). */
export function ensureHomeCodes(db: Db): number {
  const missing = db
    .select({ id: schema.classes.id })
    .from(schema.classes)
    .where(isNull(schema.classes.homeCode))
    .all();
  for (const cls of missing) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = String(randomInt(100000, 1000000));
      const taken = db
        .select({ id: schema.classes.id })
        .from(schema.classes)
        .where(and(eq(schema.classes.homeCode, code), ne(schema.classes.id, cls.id)))
        .get();
      if (taken) continue;
      db.update(schema.classes).set({ homeCode: code }).where(eq(schema.classes.id, cls.id)).run();
      break;
    }
  }
  return missing.length;
}
