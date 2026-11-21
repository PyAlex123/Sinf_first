import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FileProblem, readTables } from '@sinf/checkers';
import { eq } from 'drizzle-orm';
import {
  AddKtpRowSchema,
  CreateKtpSchema,
  LinkKtpRowsSchema,
  LocaleSchema,
  UpdateKtpRowSchema,
  type KtpLessonsResponse,
  type KtpListResponse,
  type KtpPlan,
  type ParsedTables,
  type SessionKtpResponse,
  type Teacher,
} from '@sinf/shared';
import { requireClass, requireSessionClass } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import {
  addKtpRow,
  createKtp,
  deleteKtp,
  deleteKtpRow,
  ktpPlan,
  ktpXlsx,
  lessonCatalog,
  linkKtpRows,
  listKtp,
  ownPlan,
  sessionKtp,
  updateKtpRow,
} from '../services/ktp.js';
import { XLSX_MIME } from '../services/xlsx.js';
import { attachmentHeader } from './results.js';

/**
 * The KTP (PLAN.md 5.2; stage 4, W10; ADR-020). The file is read on the server with the same
 * reader as practice files; the teacher maps the columns in the browser and sends the rows back.
 * A KTP lives on the platform only: a school computer refuses to keep one.
 */

/** A KTP file is a few dozen kilobytes; a big one is a whole year of pictures. */
const MAX_KTP_FILE_BYTES = 5 * 1024 * 1024;

const ParseQuery = z.object({ name: z.string().min(1).max(200) });
const IdParams = z.object({ id: z.string().min(1) });
const RowParams = z.object({ id: z.string().min(1), rowId: z.string().min(1) });
const ExportQuery = z.object({ lang: LocaleSchema.optional() });

export const ktpRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, content } = app.ctx;
  const onSchoolPc = (): boolean => app.sync?.link() != null;
  const platformOnly = (): void => {
    if (onSchoolPc()) throw new ApiHttpError(409, 'edit_on_platform', 'KTP lives on the website');
  };

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_KTP_FILE_BYTES },
    (_request, body, parsed) => parsed(null, body),
  );

  /** Tables of an Excel or Word file, for the KTP (W10) and the grades (W13) wizards. */
  const parse = (request: FastifyRequest): ParsedTables => {
    const { name } = ParseQuery.parse(request.query);
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new ApiHttpError(415, 'bytes_expected', 'Send the file as application/octet-stream');
    }
    try {
      const tables = readTables(new Uint8Array(body), name).filter((t) => t.rows.length > 0);
      request.log.info({ name, size: body.byteLength, tables: tables.length }, 'tables read');
      return { tables };
    } catch (error) {
      if (error instanceof FileProblem) {
        throw new ApiHttpError(422, `file_${error.kind}`, 'The file cannot be read');
      }
      throw error;
    }
  };

  app.post('/ktp/parse', { preHandler: requireTeacher }, (request): ParsedTables => {
    platformOnly();
    return parse(request);
  });

  /** Grades are imported on a school computer too: the journal's columns travel both ways. */
  app.post('/tables/parse', { preHandler: requireTeacher }, (request): ParsedTables =>
    parse(request),
  );

  app.get('/ktp', { preHandler: requireTeacher }, (request): KtpListResponse => {
    const teacher = request.teacher as Teacher;
    return { plans: onSchoolPc() ? [] : listKtp(db, teacher.id) };
  });

  app.post('/ktp', { preHandler: requireTeacher }, (request): KtpPlan => {
    platformOnly();
    const teacher = request.teacher as Teacher;
    const input = CreateKtpSchema.parse(request.body);
    requireClass(db, teacher, input.classId);
    const id = createKtp(db, teacher.id, input);
    request.log.info({ ktpId: id, rows: input.rows.length }, 'ktp imported');
    return ktpPlan(db, content, ownPlan(db, teacher.id, id));
  });

  app.get('/ktp/:id', { preHandler: requireTeacher }, (request): KtpPlan => {
    const { id } = IdParams.parse(request.params);
    const teacher = request.teacher as Teacher;
    return ktpPlan(db, content, ownPlan(db, teacher.id, id));
  });

  app.delete('/ktp/:id', { preHandler: requireTeacher }, (request): KtpListResponse => {
    const { id } = IdParams.parse(request.params);
    const teacher = request.teacher as Teacher;
    deleteKtp(db, teacher.id, id);
    return { plans: listKtp(db, teacher.id) };
  });

  // ---------- by hand, and with lessons (W11)

  const plan = (request: { params: unknown; teacher?: Teacher | null }) => {
    const { id } = IdParams.parse(request.params);
    return ownPlan(db, (request.teacher as Teacher).id, id);
  };

  app.patch('/ktp/:id/rows/:rowId', { preHandler: requireTeacher }, (request): KtpPlan => {
    platformOnly();
    const { rowId } = RowParams.parse(request.params);
    const own = plan(request);
    updateKtpRow(db, content, own.id, rowId, UpdateKtpRowSchema.parse(request.body));
    return ktpPlan(db, content, ownPlan(db, own.teacherId, own.id));
  });

  app.post('/ktp/:id/rows', { preHandler: requireTeacher }, (request): KtpPlan => {
    platformOnly();
    const own = plan(request);
    addKtpRow(db, own.id, AddKtpRowSchema.parse(request.body));
    return ktpPlan(db, content, ownPlan(db, own.teacherId, own.id));
  });

  app.delete('/ktp/:id/rows/:rowId', { preHandler: requireTeacher }, (request): KtpPlan => {
    platformOnly();
    const { rowId } = RowParams.parse(request.params);
    const own = plan(request);
    deleteKtpRow(db, own.id, rowId);
    return ktpPlan(db, content, ownPlan(db, own.teacherId, own.id));
  });

  app.post('/ktp/:id/links', { preHandler: requireTeacher }, (request): KtpPlan => {
    platformOnly();
    const own = plan(request);
    linkKtpRows(db, content, own.id, LinkKtpRowsSchema.parse(request.body).links);
    return ktpPlan(db, content, ownPlan(db, own.teacherId, own.id));
  });

  app.get('/ktp/:id/lessons', { preHandler: requireTeacher }, (request): KtpLessonsResponse => {
    const own = plan(request);
    return { lessons: lessonCatalog(db, content, own.teacherId) };
  });

  /** After a lesson: which KTP topic to mark done (W11). */
  app.get('/sessions/:id/ktp', { preHandler: requireTeacher }, (request): SessionKtpResponse => {
    const { id } = IdParams.parse(request.params);
    const teacher = request.teacher as Teacher;
    requireSessionClass(db, teacher, id);
    if (onSchoolPc()) return { ktp: null };
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    if (!session) throw notFound('Session');
    return sessionKtp(db, content, teacher.id, session);
  });

  app.get('/ktp/:id/export.xlsx', { preHandler: requireTeacher }, (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { lang } = ExportQuery.parse(request.query);
    const teacher = request.teacher as Teacher;
    const plan = ktpPlan(db, content, ownPlan(db, teacher.id, id));
    const file = ktpXlsx(plan, lang ?? teacher.locale);
    return reply
      .header('Content-Type', XLSX_MIME)
      .header('Content-Disposition', attachmentHeader(`KTP-${plan.className}.xlsx`))
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(file));
  });

  done();
};
