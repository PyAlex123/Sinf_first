import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  lessonDate,
  LocaleSchema,
  ReportQuerySchema,
  schoolYearSoFar,
  type ClassReport,
  type SchoolReport,
  type Teacher,
} from '@sinf/shared';
import { requireClass, requireSchoolAdmin } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { ApiHttpError, notFound } from '../errors.js';
import {
  classReport,
  classReportXlsx,
  schoolReport,
  schoolReportXlsx,
} from '../services/reports.js';
import { XLSX_MIME } from '../services/xlsx.js';
import { attachmentHeader } from './results.js';

/**
 * Reports (PLAN.md 8.2; stage 6, B1): the school's — for its administrator — and a class's — for
 * its teacher — over a period; the school year so far when none is given. Also as Excel files.
 */

const IdParams = z.object({ id: z.string().min(1) });
const Lang = z.object({ lang: LocaleSchema.optional() });

/** The period asked for, or the school year so far; a period that ends before it begins is refused. */
function periodOf(query: unknown): { from: string; to: string } {
  const q = ReportQuerySchema.parse(query);
  const today = lessonDate(new Date().toISOString());
  const year = schoolYearSoFar(today);
  const from = q.from ?? year.from;
  const to = q.to ?? year.to;
  if (from > to) throw new ApiHttpError(400, 'bad_period', 'The period ends before it begins');
  return { from, to };
}

export const reportRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, content } = app.ctx;

  const school = (request: {
    params: unknown;
    query: unknown;
    teacher?: Teacher | null;
  }): SchoolReport => {
    const { id } = IdParams.parse(request.params);
    const row = requireSchoolAdmin(db, request.teacher as Teacher, id);
    const { from, to } = periodOf(request.query);
    return schoolReport(db, content, { id: row.id, name: row.name }, from, to);
  };

  const ofClass = (request: {
    params: unknown;
    query: unknown;
    teacher?: Teacher | null;
  }): ClassReport => {
    const { id } = IdParams.parse(request.params);
    requireClass(db, request.teacher as Teacher, id);
    const { from, to } = periodOf(request.query);
    const report = classReport(db, content, id, from, to);
    if (!report) throw notFound('Class');
    return report;
  };

  app.get('/schools/:id/reports', { preHandler: requireTeacher }, (request) => school(request));

  app.get('/schools/:id/reports.xlsx', { preHandler: requireTeacher }, (request, reply) => {
    const report = school(request);
    const { lang } = Lang.parse(request.query);
    const file = schoolReportXlsx(report, lang ?? (request.teacher as Teacher).locale);
    return reply
      .header('Content-Type', XLSX_MIME)
      .header('Content-Disposition', attachmentHeader(`report-${report.school.name}.xlsx`))
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(file));
  });

  app.get('/classes/:id/report', { preHandler: requireTeacher }, (request) => ofClass(request));

  app.get('/classes/:id/report.xlsx', { preHandler: requireTeacher }, (request, reply) => {
    const report = ofClass(request);
    const { lang } = Lang.parse(request.query);
    const file = classReportXlsx(report, lang ?? (request.teacher as Teacher).locale);
    return reply
      .header('Content-Type', XLSX_MIME)
      .header('Content-Disposition', attachmentHeader(`report-${report.summary.name}.xlsx`))
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(file));
  });

  done();
};
