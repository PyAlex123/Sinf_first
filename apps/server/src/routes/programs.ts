import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  CreateProgramSchema,
  nextOfProgram,
  ProgramIdSchema,
  SetClassProgramSchema,
  UpdateProgramSchema,
  type ClassProgram,
  type Program,
  type ProgramItem,
  type ProgramLesson,
  type ProgramListResponse,
  type ProgramSummary,
  type Teacher,
} from '@sinf/shared';
import { colleaguesOf, requireClass } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';

/**
 * Programmes (PLAN.md 3.8; stage 4, W7): lessons for a class by quarters, the author's and the
 * teacher's own. Who sees and changes them follows the teachers' lessons (ADR-019): own; the
 * school's when shared; everyone's when public; changed by the owner, on the platform only.
 *
 * A class follows one programme; "next lesson" is its first lesson the class has not had yet.
 */

type Row = typeof schema.programs.$inferSelect;

const IdParams = z.object({ id: ProgramIdSchema });
const ClassParams = z.object({ id: z.string().min(1) });
const ListQuery = z.object({ scope: z.enum(['mine', 'school']).default('mine') });

export const programRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, content } = app.ctx;
  const readOnly = (): boolean => app.sync?.link() != null;

  const ownerName = (id: string): string =>
    db
      .select({ name: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .get()?.name ?? '—';

  const canSee = (teacher: Teacher, row: Row): boolean =>
    row.ownerId === teacher.id ||
    row.visibility === 'public' ||
    (row.visibility === 'school' && colleaguesOf(db, teacher.id).includes(row.ownerId));

  const summary = (teacher: Teacher, row: Row): ProgramSummary => ({
    id: row.id,
    ownerId: row.ownerId,
    ownerName: ownerName(row.ownerId),
    title: row.title,
    grade: row.grade,
    visibility: row.visibility,
    lessons: row.items.length,
    version: row.version,
    updatedAt: row.updatedAt,
    editable: row.ownerId === teacher.id && !readOnly(),
  });

  const lessonsOf = (items: readonly ProgramItem[]): ProgramLesson[] =>
    items.map((item) => {
      const lesson = content.getLesson(item.lessonId);
      return { ...item, title: lesson?.title ?? item.lessonId, missing: !lesson };
    });

  const full = (teacher: Teacher, row: Row): Program => ({
    ...summary(teacher, row),
    items: lessonsOf(row.items),
  });

  const live = (id: string): Row | undefined =>
    db
      .select()
      .from(schema.programs)
      .where(and(eq(schema.programs.id, id), isNull(schema.programs.deletedAt)))
      .get();

  const visibleRow = (teacher: Teacher, id: string): Row => {
    const row = live(id);
    if (!row || !canSee(teacher, row)) throw notFound('Programme');
    return row;
  };

  const ownRow = (teacher: Teacher, id: string): Row => {
    const row = visibleRow(teacher, id);
    if (row.ownerId !== teacher.id) {
      throw new ApiHttpError(403, 'not_yours', 'Only the author of a programme changes it');
    }
    if (readOnly())
      throw new ApiHttpError(409, 'edit_on_platform', 'Programmes are changed on the website');
    return row;
  };

  const newId = (): string => `p-${randomBytes(16).toString('hex')}`;

  app.get('/programs', { preHandler: requireTeacher }, (request): ProgramListResponse => {
    const teacher = request.teacher as Teacher;
    const { scope } = ListQuery.parse(request.query);
    const where =
      scope === 'mine'
        ? eq(schema.programs.ownerId, teacher.id)
        : and(
            ne(schema.programs.ownerId, teacher.id),
            inArray(schema.programs.ownerId, colleaguesOf(db, teacher.id)),
            or(eq(schema.programs.visibility, 'school'), eq(schema.programs.visibility, 'public')),
          );
    const rows = db
      .select()
      .from(schema.programs)
      .where(and(where, isNull(schema.programs.deletedAt)))
      .orderBy(desc(schema.programs.updatedAt))
      .all();
    return { programs: rows.map((row) => summary(teacher, row)) };
  });

  app.post('/programs', { preHandler: requireTeacher }, (request): Program => {
    const teacher = request.teacher as Teacher;
    if (readOnly())
      throw new ApiHttpError(409, 'edit_on_platform', 'Programmes are made on the website');
    const body = CreateProgramSchema.parse(request.body);
    const at = new Date().toISOString();
    const row: Row = {
      id: newId(),
      ownerId: teacher.id,
      title: body.title,
      grade: body.grade,
      visibility: 'private',
      items: [],
      version: 1,
      sourceId: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    db.insert(schema.programs).values(row).run();
    return full(teacher, row);
  });

  app.get('/programs/:id', { preHandler: requireTeacher }, (request): Program => {
    const teacher = request.teacher as Teacher;
    const { id } = IdParams.parse(request.params);
    return full(teacher, visibleRow(teacher, id));
  });

  app.put('/programs/:id', { preHandler: requireTeacher }, (request): Program => {
    const teacher = request.teacher as Teacher;
    const { id } = IdParams.parse(request.params);
    const body = UpdateProgramSchema.parse(request.body);
    const row = ownRow(teacher, id);
    if (body.version !== row.version) {
      throw new ApiHttpError(409, 'version_conflict', 'The programme was changed elsewhere', {
        version: row.version,
      });
    }
    // Only lessons that exist: a typo in an id would be a hole in the year.
    for (const item of body.items) {
      if (!content.getLesson(item.lessonId)) {
        throw new ApiHttpError(400, 'no_such_lesson', `No lesson "${item.lessonId}"`);
      }
    }
    const next: Row = {
      ...row,
      title: body.title,
      grade: body.grade,
      visibility: body.visibility,
      items: body.items,
      version: row.version + 1,
      updatedAt: new Date().toISOString(),
    };
    db.update(schema.programs)
      .set({
        title: next.title,
        grade: next.grade,
        visibility: next.visibility,
        items: next.items,
        version: next.version,
        updatedAt: next.updatedAt,
      })
      .where(and(eq(schema.programs.id, id), eq(schema.programs.version, row.version)))
      .run();
    return full(teacher, next);
  });

  app.delete('/programs/:id', { preHandler: requireTeacher }, (request): { ok: true } => {
    const teacher = request.teacher as Teacher;
    const { id } = IdParams.parse(request.params);
    ownRow(teacher, id);
    const at = new Date().toISOString();
    db.update(schema.programs)
      .set({ deletedAt: at, updatedAt: at })
      .where(eq(schema.programs.id, id))
      .run();
    // Classes that followed it follow none now.
    db.update(schema.classes)
      .set({ programId: null })
      .where(eq(schema.classes.programId, id))
      .run();
    return { ok: true };
  });

  app.post('/programs/:id/copy', { preHandler: requireTeacher }, (request): Program => {
    const teacher = request.teacher as Teacher;
    if (readOnly())
      throw new ApiHttpError(409, 'edit_on_platform', 'Programmes are made on the website');
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
    db.insert(schema.programs).values(row).run();
    return full(teacher, row);
  });

  // ---------- a class and its programme

  const classProgram = (teacher: Teacher, classId: string): ClassProgram => {
    const cls = requireClass(db, teacher, classId);
    const row = cls.programId ? live(cls.programId) : undefined;
    if (!row) return { program: null, items: [], next: null };
    const held = new Set(
      db
        .select({ lessonId: schema.sessions.lessonId })
        .from(schema.sessions)
        .where(eq(schema.sessions.classId, classId))
        .all()
        .map((s) => s.lessonId),
    );
    const items = lessonsOf(row.items);
    return {
      program: summary(teacher, row),
      items: items.map((item) => ({ ...item, done: held.has(item.lessonId) })),
      next: nextOfProgram(items, held),
    };
  };

  app.get('/classes/:id/program', { preHandler: requireTeacher }, (request): ClassProgram => {
    const { id } = ClassParams.parse(request.params);
    return classProgram(request.teacher as Teacher, id);
  });

  app.put('/classes/:id/program', { preHandler: requireTeacher }, (request): ClassProgram => {
    const teacher = request.teacher as Teacher;
    const { id } = ClassParams.parse(request.params);
    const { programId } = SetClassProgramSchema.parse(request.body);
    requireClass(db, teacher, id);
    if (readOnly())
      throw new ApiHttpError(409, 'edit_on_platform', 'Programmes are set on the website');
    if (programId) visibleRow(teacher, programId);
    db.update(schema.classes).set({ programId }).where(eq(schema.classes.id, id)).run();
    return classProgram(teacher, id);
  });

  done();
};
