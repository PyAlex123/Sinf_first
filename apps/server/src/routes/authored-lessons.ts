import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  AssetExtensionSchema,
  AUTHORED_ID_PREFIX,
  authoredCounts,
  AuthoredLessonDocSchema,
  AuthoredLessonIdSchema,
  CreateAuthoredLessonSchema,
  emptyLessonDoc,
  IMAGE_ASSET_EXTENSIONS,
  MAX_FILE_ASSET_BYTES,
  standardLessonDoc,
  UpdateAuthoredLessonSchema,
  type AuthoredLesson,
  type AuthoredLessonListResponse,
  type AuthoredLessonSummary,
  type AssetUploadResponse,
  type Course,
  type SyncAuthoredLesson,
  type SyncLessonList,
  type Teacher,
} from '@sinf/shared';
import { colleaguesOf, requireDevice } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import { ASSET_MIME, assetPath, storeAsset } from '../services/assets.js';

/**
 * Teachers' own lessons (stage 4, W1; ADR-019): the list, the constructor's reads and saves, the
 * lesson's files, and the copy every school computer keeps of its school's lessons.
 *
 * Who sees a lesson: its owner; a teacher of the same school when it is "school" or "public"; any
 * teacher when it is "public". Who changes it: its owner, and only on the platform — a school
 * computer's copy is read-only and would be overwritten by the next sync.
 *
 * To play a lesson nobody needs to log in: `/api/lessons/:id` gives it by id like the author's, and
 * an id is 128 random bits. A child in a lesson must be able to load it, and has no account.
 */

type Row = typeof schema.authoredLessons.$inferSelect;

const IdParams = z.object({ id: AuthoredLessonIdSchema });
const AssetParams = z.object({
  file: z.string().regex(/^[0-9a-f]{64}\.[a-z]+$/),
});
const UploadQuery = z.object({ ext: AssetExtensionSchema });
const ListQuery = z.object({ scope: z.enum(['mine', 'school']).default('mine') });

export const authoredLessonRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, config, content } = app.ctx;
  /** A school computer mirrors lessons from the platform and changes none (ADR-019). */
  const readOnly = (): boolean => app.sync?.link() != null;

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_FILE_ASSET_BYTES },
    (_request, body, parsed) => parsed(null, body),
  );

  const ownerName = (id: string): string =>
    db
      .select({ name: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .get()?.name ?? '—';

  const colleagues = (teacher: Teacher): string[] => colleaguesOf(db, teacher.id);

  const canSee = (teacher: Teacher, row: Row): boolean =>
    row.ownerId === teacher.id ||
    row.visibility === 'public' ||
    (row.visibility === 'school' && colleagues(teacher).includes(row.ownerId));

  const summary = (teacher: Teacher, row: Row): AuthoredLessonSummary => {
    const doc = AuthoredLessonDocSchema.parse(row.doc);
    const counts = authoredCounts(doc);
    return {
      id: row.id,
      ownerId: row.ownerId,
      ownerName: ownerName(row.ownerId),
      title: row.title,
      grade: row.grade,
      topic: row.topic,
      visibility: row.visibility,
      minutes: counts.minutes,
      screens: counts.screens,
      version: row.version,
      updatedAt: row.updatedAt,
      editable: row.ownerId === teacher.id && !readOnly(),
    };
  };

  const full = (teacher: Teacher, row: Row): AuthoredLesson => ({
    ...summary(teacher, row),
    doc: AuthoredLessonDocSchema.parse(row.doc),
  });

  const live = (id: string): Row | undefined =>
    db
      .select()
      .from(schema.authoredLessons)
      .where(and(eq(schema.authoredLessons.id, id), isNull(schema.authoredLessons.deletedAt)))
      .get();

  const visibleRow = (teacher: Teacher, id: string): Row => {
    const row = live(id);
    if (!row || !canSee(teacher, row)) throw notFound('Lesson');
    return row;
  };

  const ownRow = (teacher: Teacher, id: string): Row => {
    const row = visibleRow(teacher, id);
    if (row.ownerId !== teacher.id) {
      throw new ApiHttpError(403, 'not_yours', 'Only the author of a lesson changes it');
    }
    if (readOnly()) {
      throw new ApiHttpError(409, 'edit_on_platform', 'Lessons are changed on the website');
    }
    return row;
  };

  const newId = (): string => `${AUTHORED_ID_PREFIX}${randomBytes(16).toString('hex')}`;

  // ---------- the teacher

  app.get(
    '/api/authored-lessons',
    { preHandler: requireTeacher },
    (request): AuthoredLessonListResponse => {
      const teacher = request.teacher as Teacher;
      const { scope } = ListQuery.parse(request.query);
      const where =
        scope === 'mine'
          ? eq(schema.authoredLessons.ownerId, teacher.id)
          : and(
              ne(schema.authoredLessons.ownerId, teacher.id),
              inArray(schema.authoredLessons.ownerId, colleagues(teacher)),
              or(
                eq(schema.authoredLessons.visibility, 'school'),
                eq(schema.authoredLessons.visibility, 'public'),
              ),
            );
      const rows = db
        .select()
        .from(schema.authoredLessons)
        .where(and(where, isNull(schema.authoredLessons.deletedAt)))
        .orderBy(desc(schema.authoredLessons.updatedAt))
        .all();
      return { lessons: rows.map((row) => summary(teacher, row)) };
    },
  );

  app.post('/api/authored-lessons', { preHandler: requireTeacher }, (request): AuthoredLesson => {
    const teacher = request.teacher as Teacher;
    if (readOnly())
      throw new ApiHttpError(409, 'edit_on_platform', 'Lessons are made on the website');
    const body = CreateAuthoredLessonSchema.parse(request.body);
    const at = new Date().toISOString();
    const row: Row = {
      id: newId(),
      ownerId: teacher.id,
      title: body.title,
      grade: body.grade,
      topic: body.topic,
      visibility: body.visibility,
      doc:
        body.template === 'standard45' ? standardLessonDoc(body.title) : emptyLessonDoc(body.title),
      version: 1,
      sourceId: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    db.insert(schema.authoredLessons).values(row).run();
    request.log.info({ lessonId: row.id }, 'lesson created');
    return full(teacher, row);
  });

  app.get(
    '/api/authored-lessons/:id',
    { preHandler: requireTeacher },
    (request): AuthoredLesson => {
      const teacher = request.teacher as Teacher;
      const { id } = IdParams.parse(request.params);
      return full(teacher, visibleRow(teacher, id));
    },
  );

  app.put(
    '/api/authored-lessons/:id',
    { preHandler: requireTeacher },
    (request): AuthoredLesson => {
      const teacher = request.teacher as Teacher;
      const { id } = IdParams.parse(request.params);
      const body = UpdateAuthoredLessonSchema.parse(request.body);
      const row = ownRow(teacher, id);
      if (body.version !== row.version) {
        throw new ApiHttpError(409, 'version_conflict', 'The lesson was changed elsewhere', {
          version: row.version,
        });
      }
      const next: Row = {
        ...row,
        title: body.title,
        grade: body.grade,
        topic: body.topic,
        visibility: body.visibility,
        doc: body.doc,
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      };
      db.update(schema.authoredLessons)
        .set({
          title: next.title,
          grade: next.grade,
          topic: next.topic,
          visibility: next.visibility,
          doc: next.doc,
          version: next.version,
          updatedAt: next.updatedAt,
        })
        // The version in the condition too: two saves at the same moment cannot both win.
        .where(
          and(eq(schema.authoredLessons.id, id), eq(schema.authoredLessons.version, row.version)),
        )
        .run();
      return full(teacher, next);
    },
  );

  app.delete(
    '/api/authored-lessons/:id',
    { preHandler: requireTeacher },
    (request): { ok: true } => {
      const teacher = request.teacher as Teacher;
      const { id } = IdParams.parse(request.params);
      ownRow(teacher, id);
      const at = new Date().toISOString();
      db.update(schema.authoredLessons)
        .set({ deletedAt: at, updatedAt: at })
        .where(eq(schema.authoredLessons.id, id))
        .run();
      request.log.info({ lessonId: id }, 'lesson deleted');
      return { ok: true };
    },
  );

  /** A copy of a lesson the teacher can see, to change as their own (W8 builds the library on it). */
  app.post(
    '/api/authored-lessons/:id/copy',
    { preHandler: requireTeacher },
    (request): AuthoredLesson => {
      const teacher = request.teacher as Teacher;
      if (readOnly())
        throw new ApiHttpError(409, 'edit_on_platform', 'Lessons are made on the website');
      const { id } = IdParams.parse(request.params);
      const source = visibleRow(teacher, id);
      const at = new Date().toISOString();
      const row: Row = {
        ...source,
        id: newId(),
        ownerId: teacher.id,
        visibility: 'private',
        version: 1,
        sourceId: source.id,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      db.insert(schema.authoredLessons).values(row).run();
      return full(teacher, row);
    },
  );

  // ---------- files of lessons

  app.post('/api/assets', { preHandler: requireTeacher }, (request): AssetUploadResponse => {
    if (readOnly())
      throw new ApiHttpError(409, 'edit_on_platform', 'Lessons are made on the website');
    const { ext } = UploadQuery.parse(request.query);
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new ApiHttpError(415, 'bytes_expected', 'Send the file as application/octet-stream');
    }
    const result = storeAsset(config.dataDir, new Uint8Array(body), ext);
    request.log.info({ sha: result.sha, ext, size: result.size }, 'lesson file stored');
    return result;
  });

  /**
   * A lesson file, by its content. Pictures are shown; a template is only ever downloaded, with
   * nosniff and a sandbox, as every file a person uploaded (ADR-015).
   */
  app.get('/content/_assets/:file', (request, reply) => {
    const { file } = AssetParams.parse(request.params);
    const [sha = '', extRaw = ''] = file.split('.');
    const ext = AssetExtensionSchema.safeParse(extRaw);
    if (!ext.success) throw notFound('File');
    const path = assetPath(config.dataDir, sha, ext.data);
    if (!existsSync(path)) throw notFound('File');
    const picture = IMAGE_ASSET_EXTENSIONS.includes(ext.data);
    return reply
      .header('Content-Type', ASSET_MIME[ext.data])
      .header('Content-Disposition', picture ? 'inline' : `attachment; filename="${file}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  /** The course a lesson plays in: the author's, or the one made for a teacher's lesson. */
  app.get('/api/lessons/:id/course', (request): Course => {
    const { id } = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params);
    const course = content.getCourseOf(id);
    if (!course) throw notFound(`Lesson "${id}" not found`);
    return course;
  });

  // ---------- a school computer (ADR-011, ADR-019)

  /** The lessons of this school's teachers, as versions: the computer fetches only what changed. */
  app.get('/api/sync/lessons', async (request): Promise<SyncLessonList> => {
    const device = await requireDevice(db, request.headers.authorization);
    return {
      lessons: db
        .select({
          id: schema.authoredLessons.id,
          version: schema.authoredLessons.version,
          updatedAt: schema.authoredLessons.updatedAt,
        })
        .from(schema.authoredLessons)
        .innerJoin(
          schema.schoolMembers,
          eq(schema.schoolMembers.userId, schema.authoredLessons.ownerId),
        )
        .where(
          and(
            eq(schema.schoolMembers.schoolId, device.schoolId),
            isNull(schema.authoredLessons.deletedAt),
          ),
        )
        .all()
        .map((r) => ({ ...r, id: r.id })),
    };
  });

  const schoolLesson = async (authorization: string | undefined, id: string): Promise<Row> => {
    const device = await requireDevice(db, authorization);
    const row = live(id);
    const member =
      row &&
      db
        .select({ userId: schema.schoolMembers.userId })
        .from(schema.schoolMembers)
        .where(
          and(
            eq(schema.schoolMembers.userId, row.ownerId),
            eq(schema.schoolMembers.schoolId, device.schoolId),
          ),
        )
        .get();
    if (!row || !member) throw notFound('Lesson');
    return row;
  };

  app.get('/api/sync/lessons/:id', async (request): Promise<SyncAuthoredLesson> => {
    const { id } = IdParams.parse(request.params);
    const row = await schoolLesson(request.headers.authorization, id);
    return {
      id: row.id,
      ownerId: row.ownerId,
      title: row.title,
      grade: row.grade,
      topic: row.topic,
      visibility: row.visibility,
      doc: AuthoredLessonDocSchema.parse(row.doc),
      version: row.version,
      sourceId: row.sourceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  done();
};
