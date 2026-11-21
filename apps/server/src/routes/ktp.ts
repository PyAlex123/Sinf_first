import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { FileProblem, readTables } from '@sinf/checkers';
import {
  CreateKtpSchema,
  LocaleSchema,
  type KtpListResponse,
  type KtpPlan,
  type ParsedTables,
  type Teacher,
} from '@sinf/shared';
import { requireClass } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { ApiHttpError } from '../errors.js';
import { createKtp, deleteKtp, ktpPlan, ktpXlsx, listKtp, ownPlan } from '../services/ktp.js';
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

  app.post('/ktp/parse', { preHandler: requireTeacher }, (request): ParsedTables => {
    platformOnly();
    const { name } = ParseQuery.parse(request.query);
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new ApiHttpError(415, 'bytes_expected', 'Send the file as application/octet-stream');
    }
    try {
      const tables = readTables(new Uint8Array(body), name).filter((t) => t.rows.length > 0);
      request.log.info({ name, size: body.byteLength, tables: tables.length }, 'ktp file read');
      return { tables };
    } catch (error) {
      if (error instanceof FileProblem) {
        throw new ApiHttpError(422, `file_${error.kind}`, 'The file cannot be read');
      }
      throw error;
    }
  });

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
