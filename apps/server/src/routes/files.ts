import { createReadStream } from 'node:fs';
import { PassThrough, Readable } from 'node:stream';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { Zip, ZipPassThrough } from 'fflate';
import { z } from 'zod';
import {
  ClassCodeSchema,
  extensionOf,
  fileNameKey,
  normalizeFileName,
  HomeLoginSchema,
  PREVIEWABLE_EXTENSIONS,
  type FileUploadResponse,
  type HomeLookupResponse,
  type HomeMeResponse,
  type StudentFilesResponse,
  type SyncedFilesResponse,
  type Teacher,
} from '@sinf/shared';
import { requireClass, requireDevice, requireStudent } from '../auth/access.js';
import { verifySecret } from '../auth/password.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import type { SessionStore } from '../realtime/session-store.js';
import { AttemptGuard } from '../services/attempt-guard.js';
import {
  blobPath,
  collect,
  deleteFile,
  findFile,
  listFiles,
  storeUpload,
  UploadGate,
} from '../services/student-files.js';
import { asciiFileName } from './results.js';

/**
 * "Мои работы" (CLAUDE.md §4.9; stage 3, H12; ADR-015).
 *
 * Who may reach a child's folder:
 * - the child in a lesson — the lesson token of `POST /api/join` (`x-session-id` and
 *   `x-participant-token` headers), in the classroom and in a browser alike;
 * - the child at home — class code from the card, name, personal code; a short signed cookie;
 * - a teacher of the class — to look and to collect the class's works;
 * - nobody else, by any route: another child's file answers 404.
 *
 * Files never run here. Everything is sent as a download with `nosniff` and a sandboxing CSP: a
 * child's .html must not run with the teacher's login (stored XSS). Only pictures may be shown.
 */

export const STUDENT_COOKIE = 'sinf_student';
const STUDENT_COOKIE_MAX_AGE_SECONDS = 3 * 60 * 60;

const FileParams = z.object({ id: z.string().min(1) });
const StudentParams = z.object({ id: z.string().min(1) });
const StudentFileParams = z.object({ id: z.string().min(1), fileId: z.string().min(1) });
const ClassParams = z.object({ id: z.string().min(1) });
const UploadQuery = z.object({
  name: z.string().min(1).max(400),
  base: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
const ContentQuery = z.object({ inline: z.enum(['0', '1']).optional() });
const LookupBody = z.strictObject({ classCode: ClassCodeSchema });

type StudentRow = typeof schema.students.$inferSelect;

/** RFC 6266: a Latin fallback for old clients, the real name for everyone else. */
export function attachmentHeader(name: string, inline = false): string {
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export const fileRoutes: FastifyPluginCallback<{ store: SessionStore }> = (app, opts, done) => {
  const { store } = opts;
  const { db, config } = app.ctx;
  const gate = new UploadGate();
  // Six digits of a class code would otherwise let anyone list the children of every class.
  const lookups = new AttemptGuard(10, 10 * 60 * 1000);
  const logins = new AttemptGuard(5, 2 * 60 * 1000);
  /** A school computer keeps local changes for the platform (ADR-011). */
  const trackChanges = (): boolean => app.sync?.link() != null;

  // Uploads are raw bytes, streamed; this parser hands the request stream over untouched. Fastify's
  // body limit does not apply to it, so the length is checked by hand (services/student-files.ts).
  app.addContentTypeParser('application/octet-stream', (_request, payload, parsed) => {
    parsed(null, payload);
  });

  const studentRow = (id: string): StudentRow => {
    const row = db.select().from(schema.students).where(eq(schema.students.id, id)).get();
    if (!row || !row.isActive || row.isVirtual) throw notFound('Student');
    return row;
  };

  /** The child behind this request: a lesson token, or the home cookie. */
  const childOf = (request: FastifyRequest): StudentRow => {
    const sessionId = request.headers['x-session-id'];
    const token = request.headers['x-participant-token'];
    if (typeof sessionId === 'string' && typeof token === 'string') {
      const participantId = store.participantByToken(sessionId, token);
      const studentId = participantId
        ? store.getState(sessionId)?.participants[participantId]?.studentId
        : undefined;
      if (studentId) return studentRow(studentId);
    }
    const raw = request.cookies[STUDENT_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      const [studentId, until] = unsigned.valid && unsigned.value ? unsigned.value.split('|') : [];
      if (studentId && Number(until) > Date.now()) return studentRow(studentId);
    }
    throw new ApiHttpError(401, 'unauthorized', 'Log in first');
  };

  const sendFile = (
    reply: FastifyReply,
    row: { name: string; sha256: string | null; size: number },
    inline: boolean,
  ) => {
    if (!row.sha256) throw notFound('File');
    const ext = extensionOf(row.name);
    const picture = inline && PREVIEWABLE_EXTENSIONS.includes(ext);
    return reply
      .header(
        'Content-Type',
        picture ? (IMAGE_TYPES[ext] ?? 'application/octet-stream') : 'application/octet-stream',
      )
      .header('Content-Length', row.size)
      .header('Content-Disposition', attachmentHeader(row.name, picture))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .header('Cache-Control', 'private, no-cache')
      .send(createReadStream(blobPath(config.dataDir, row.sha256)));
  };

  const upload = async (request: FastifyRequest, child: StudentRow, origin: string) => {
    const query = UploadQuery.parse(request.query);
    const declared = Number(request.headers['content-length']);
    const body = request.body;
    if (!(body instanceof Readable)) {
      throw new ApiHttpError(415, 'bytes_expected', 'Send the file as application/octet-stream');
    }
    return gate.run(() =>
      storeUpload(db, config.dataDir, {
        studentId: child.id,
        rawName: query.name,
        baseSha: query.base ?? null,
        origin,
        body,
        declaredSize: Number.isFinite(declared) ? declared : -1,
        trackChanges: trackChanges(),
      }),
    );
  };

  /** Where an upload came from, as the child's folder will show it. */
  const originOf = (request: FastifyRequest, child: StudentRow): string => {
    const sessionId = request.headers['x-session-id'];
    if (typeof sessionId === 'string') {
      const state = store.getState(sessionId);
      const pc = state?.participants[child.id]?.pc;
      if (pc) return pc;
    }
    return 'браузер';
  };

  // ---------- the child's own folder

  app.get('/my/files', (request): StudentFilesResponse => listFiles(db, childOf(request)));

  app.put('/my/files', async (request): Promise<FileUploadResponse> => {
    const child = childOf(request);
    const result = await upload(request, child, originOf(request, child));
    request.log.info(
      {
        studentId: child.id,
        name: result.file.name,
        size: result.file.size,
        conflict: result.conflictWith,
      },
      'student file saved',
    );
    return result;
  });

  app.get('/my/files/:id/content', (request, reply) => {
    const child = childOf(request);
    const { id } = FileParams.parse(request.params);
    const { inline } = ContentQuery.parse(request.query);
    return sendFile(reply, findFile(db, child.id, id), inline === '1');
  });

  app.delete('/my/files/:id', (request): StudentFilesResponse => {
    const child = childOf(request);
    const { id } = FileParams.parse(request.params);
    deleteFile(db, config.dataDir, child.id, id, trackChanges());
    return listFiles(db, child);
  });

  // ---------- the teacher

  app.get(
    '/students/:id/files',
    { preHandler: requireTeacher },
    (request): StudentFilesResponse => {
      const { id } = StudentParams.parse(request.params);
      const { student } = requireStudent(db, request.teacher as Teacher, id);
      return listFiles(db, student);
    },
  );

  app.get(
    '/students/:id/files/:fileId/content',
    { preHandler: requireTeacher },
    (request, reply) => {
      const { id, fileId } = StudentFileParams.parse(request.params);
      const { inline } = ContentQuery.parse(request.query);
      requireStudent(db, request.teacher as Teacher, id);
      return sendFile(reply, findFile(db, id, fileId), inline === '1');
    },
  );

  /**
   * "Собрать работы": the class's folders in one ZIP, a folder per child. Streamed: the files are
   * read one after another and never all held in memory. Stored without compression — documents and
   * pictures are compressed already, and the teacher's computer is slow.
   */
  app.get('/classes/:id/works.zip', { preHandler: requireTeacher }, (request, reply) => {
    const { id } = ClassParams.parse(request.params);
    const cls = requireClass(db, request.teacher as Teacher, id);
    const rows = db
      .select({
        name: schema.studentFiles.name,
        sha256: schema.studentFiles.sha256,
        lastName: schema.students.lastName,
        firstName: schema.students.firstName,
      })
      .from(schema.studentFiles)
      .innerJoin(schema.students, eq(schema.students.id, schema.studentFiles.studentId))
      .where(and(eq(schema.students.classId, cls.id), isNull(schema.studentFiles.deletedAt)))
      .orderBy(schema.students.lastName, schema.students.firstName, schema.studentFiles.nameKey)
      .all();

    const out = new PassThrough();
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        out.destroy(error);
        return;
      }
      out.write(chunk);
      if (final) out.end();
    });
    void (async () => {
      try {
        for (const row of rows) {
          if (!row.sha256) continue;
          const entry = new ZipPassThrough(`${row.lastName} ${row.firstName}/${row.name}`);
          zip.add(entry);
          for await (const chunk of createReadStream(blobPath(config.dataDir, row.sha256))) {
            entry.push(chunk as Uint8Array);
            if (out.writableNeedDrain) await new Promise((r) => out.once('drain', r));
          }
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      } catch (error) {
        out.destroy(error as Error);
      }
    })();
    request.log.info({ classId: cls.id, files: rows.length }, 'class works collected');
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', attachmentHeader(`Работы ${cls.name}.zip`))
      .header('Cache-Control', 'no-store')
      .send(out);
  });

  // ---------- a school computer and the platform (H12; ADR-011, ADR-015)

  const SyncParams = z.object({ studentId: z.string().min(1) });
  const BlobParams = z.object({
    studentId: z.string().min(1),
    sha: z.string().regex(/^[0-9a-f]{64}$/),
  });
  const SyncPutQuery = UploadQuery.extend({
    origin: z.string().min(1).max(40).default('ПК учителя'),
  });

  /** Only a child of the device's own school; anything else is 404, as everywhere (ADR-009). */
  const schoolChild = async (request: FastifyRequest, studentId: string): Promise<StudentRow> => {
    const device = await requireDevice(db, request.headers.authorization);
    const child = db.select().from(schema.students).where(eq(schema.students.id, studentId)).get();
    const cls = child
      ? db.select().from(schema.classes).where(eq(schema.classes.id, child.classId)).get()
      : undefined;
    if (!child || !cls || cls.schoolId !== device.schoolId) throw notFound('Student');
    return child;
  };

  app.get('/sync/files/:studentId', async (request): Promise<SyncedFilesResponse> => {
    const { studentId } = SyncParams.parse(request.params);
    const child = await schoolChild(request, studentId);
    return {
      studentId: child.id,
      files: listFiles(db, child).files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        size: f.size,
        updatedAt: f.updatedAt,
        deleted: false,
      })),
    };
  });

  app.get('/sync/files/:studentId/blob/:sha', async (request, reply) => {
    const { studentId, sha } = BlobParams.parse(request.params);
    const child = await schoolChild(request, studentId);
    const row = db
      .select()
      .from(schema.studentFiles)
      .where(
        and(
          eq(schema.studentFiles.studentId, child.id),
          eq(schema.studentFiles.sha256, sha),
          isNull(schema.studentFiles.deletedAt),
        ),
      )
      .get();
    if (!row) throw notFound('File');
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', row.size)
      .send(createReadStream(blobPath(config.dataDir, sha)));
  });

  app.put('/sync/files/:studentId', async (request): Promise<FileUploadResponse> => {
    const { studentId } = SyncParams.parse(request.params);
    const child = await schoolChild(request, studentId);
    const query = SyncPutQuery.parse(request.query);
    const declared = Number(request.headers['content-length']);
    const body = request.body;
    if (!(body instanceof Readable)) {
      throw new ApiHttpError(415, 'bytes_expected', 'Send the file as application/octet-stream');
    }
    return gate.run(() =>
      storeUpload(db, config.dataDir, {
        studentId: child.id,
        rawName: query.name,
        baseSha: query.base ?? null,
        origin: query.origin,
        body,
        declaredSize: Number.isFinite(declared) ? declared : -1,
        trackChanges: false,
      }),
    );
  });

  /** A file deleted on a school computer; refused when it changed here meanwhile (409). */
  app.delete('/sync/files/:studentId', async (request): Promise<{ ok: true }> => {
    const { studentId } = SyncParams.parse(request.params);
    const child = await schoolChild(request, studentId);
    const query = UploadQuery.parse(request.query);
    const named = normalizeFileName(query.name);
    if (!named.ok) throw notFound('File');
    const row = db
      .select()
      .from(schema.studentFiles)
      .where(
        and(
          eq(schema.studentFiles.studentId, child.id),
          eq(schema.studentFiles.nameKey, fileNameKey(named.name)),
          isNull(schema.studentFiles.deletedAt),
        ),
      )
      .get();
    if (!row) throw notFound('File');
    if (row.sha256 !== (query.base ?? null)) {
      throw new ApiHttpError(409, 'changed', 'The file changed since');
    }
    db.delete(schema.studentFiles).where(eq(schema.studentFiles.id, row.id)).run();
    collect(db, config.dataDir, row.sha256);
    return { ok: true };
  });

  // ---------- a child at home: class code → name → personal code (author's choice, H12)

  const classByCode = (code: string) =>
    db.select().from(schema.classes).where(eq(schema.classes.homeCode, code)).get();

  /** Picture codes are too easy to guess from home (36 pairs): those classes wait for QR cards. */
  const digitStudents = (classId: string) =>
    db
      .select()
      .from(schema.students)
      .where(
        and(
          eq(schema.students.classId, classId),
          eq(schema.students.isActive, true),
          eq(schema.students.isVirtual, false),
        ),
      )
      .orderBy(schema.students.sortOrder)
      .all();

  app.post('/my/lookup', (request): HomeLookupResponse => {
    const now = Date.now();
    const key = `ip:${request.ip}`;
    const status = lookups.status(key, now);
    if (status.locked) {
      throw new ApiHttpError(429, 'locked', 'Too many wrong codes, try later', {
        retryAfterSec: status.retryAfterSec,
      });
    }
    const { classCode } = LookupBody.parse(request.body);
    const cls = classByCode(classCode);
    if (!cls) {
      lookups.fail(key, now);
      throw notFound('Class');
    }
    const students = digitStudents(cls.id);
    if (students.some((s) => s.codeKind !== 'digits')) {
      throw new ApiHttpError(403, 'picture_codes', 'This class logs in at school only');
    }
    return {
      class: { id: cls.id, name: cls.name },
      students: students.map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName })),
    };
  });

  app.post('/my/login', async (request, reply): Promise<HomeMeResponse> => {
    const body = HomeLoginSchema.parse(request.body);
    const cls = classByCode(body.classCode);
    const student = db
      .select()
      .from(schema.students)
      .where(eq(schema.students.id, body.studentId))
      .get();
    if (!cls || !student || student.classId !== cls.id || !student.isActive || student.isVirtual) {
      throw notFound('Student');
    }
    if (student.codeKind !== 'digits') {
      throw new ApiHttpError(403, 'picture_codes', 'This class logs in at school only');
    }
    const key = `home:${student.id}`;
    const now = Date.now();
    const status = logins.status(key, now);
    if (status.locked) {
      throw new ApiHttpError(429, 'locked', 'Too many wrong codes, try later', {
        retryAfterSec: status.retryAfterSec,
      });
    }
    const ok = await verifySecret(body.code.join(''), student.codeHash);
    if (!ok) {
      const after = logins.fail(key, now);
      throw new ApiHttpError(
        401,
        after.locked ? 'locked' : 'wrong_code',
        after.locked ? 'Too many wrong codes, try later' : 'Wrong code',
        after.locked
          ? { retryAfterSec: after.retryAfterSec }
          : { attemptsLeft: after.attemptsLeft },
      );
    }
    logins.reset(key);
    void reply.setCookie(
      STUDENT_COOKIE,
      `${student.id}|${now + STUDENT_COOKIE_MAX_AGE_SECONDS * 1000}`,
      {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: config.env === 'production',
        path: '/',
        maxAge: STUDENT_COOKIE_MAX_AGE_SECONDS,
      },
    );
    request.log.info({ studentId: student.id }, 'student logged in from home');
    return {
      student: {
        id: student.id,
        name: `${student.lastName} ${student.firstName}`,
        className: cls.name,
      },
    };
  });

  app.get('/my/me', (request): HomeMeResponse => {
    const child = childOf(request);
    const cls = db.select().from(schema.classes).where(eq(schema.classes.id, child.classId)).get();
    return {
      student: {
        id: child.id,
        name: `${child.lastName} ${child.firstName}`,
        className: cls?.name ?? '',
      },
    };
  });

  app.delete('/my/login', (_request, reply): { ok: true } => {
    void reply.clearCookie(STUDENT_COOKIE, { path: '/' });
    return { ok: true };
  });

  done();
};
