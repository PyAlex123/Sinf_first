import { createReadStream, existsSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  LocaleSchema,
  SetGradesSchema,
  SetPracticeMarksSchema,
  type Journal,
  type SessionResults,
  type Teacher,
} from '@sinf/shared';
import { requireClass, requireSessionClass } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { notFound } from '../errors.js';
import { blobPath } from '../services/student-files.js';
import { journalFileName, journalXlsx } from '../services/journal-export.js';
import { classJournal, sessionResults, setSessionGrades } from '../services/results.js';
import { XLSX_MIME } from '../services/xlsx.js';

const SessionParams = z.object({ id: z.string().min(1) });
const ClassParams = z.object({ classId: z.string().min(1) });
const ExportQuery = z.object({ lang: LocaleSchema.optional() });
const WorkParams = z.object({ id: z.string().min(1), studentId: z.string().min(1) });

const LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: 'o',
  қ: 'q',
  ғ: 'g',
  ҳ: 'h',
};

/**
 * A file name in plain Latin letters. Browsers disagree about non-ASCII names in
 * `Content-Disposition` (headless Chromium drops them altogether and saves "download"), so the
 * class name "1А" travels as "1A" — a teacher still recognises it.
 */
export function asciiFileName(name: string): string {
  return [...name]
    .map((ch) => {
      const lower = ch.toLowerCase();
      const latin = LATIN[lower];
      if (latin === undefined) return ch;
      return ch === lower ? latin : latin.charAt(0).toUpperCase() + latin.slice(1);
    })
    .join('')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
}

/** RFC 6266: a Latin fallback for old clients, the real name for everyone else. */
export function attachmentHeader(name: string, inline = false): string {
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Lesson results and the class journal (S1.13). Teacher only, through the access module (ADR-009). */
export const resultRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, content } = app.ctx;

  app.get('/sessions/:id/results', { preHandler: requireTeacher }, (request): SessionResults => {
    const { id } = SessionParams.parse(request.params);
    requireSessionClass(db, request.teacher as Teacher, id);
    const results = sessionResults(db, content, id);
    if (!results) throw notFound('Session not found');
    return results;
  });

  /** The teacher confirms the suggested grades or sets their own, one child or the whole class (H10). */
  app.put('/sessions/:id/grades', { preHandler: requireTeacher }, (request): SessionResults => {
    const { id } = SessionParams.parse(request.params);
    const body = SetGradesSchema.parse(request.body);
    requireSessionClass(db, request.teacher as Teacher, id);
    const results = setSessionGrades(db, content, id, body);
    if (!results) throw notFound('Session not found');
    request.log.info({ sessionId: id, grades: body.grades.length }, 'grades set');
    // On a school computer the lesson goes to the platform again, with its grades.
    void app.sync?.push();
    return results;
  });

  /** The teacher's marks on the practice's criteria (H16), during the lesson or after it. */
  app.put(
    '/sessions/:id/practice-marks',
    { preHandler: requireTeacher },
    (request): SessionResults => {
      const { id } = SessionParams.parse(request.params);
      const body = SetPracticeMarksSchema.parse(request.body);
      requireSessionClass(db, request.teacher as Teacher, id);
      app.practice.setMarks(id, body);
      request.log.info({ sessionId: id, studentId: body.studentId }, 'practice marked');
      void app.sync?.push();
      const results = sessionResults(db, content, id);
      if (!results) throw notFound('Session not found');
      return results;
    },
  );

  /**
   * The child's practice file as handed in — or, before that, as last checked (H16). Always as an
   * attachment, like any file of a child (ADR-015): it is opened in Word, not in the browser.
   */
  app.get(
    '/sessions/:id/practice/:studentId/file',
    { preHandler: requireTeacher },
    (request, reply) => {
      const { id, studentId } = WorkParams.parse(request.params);
      requireSessionClass(db, request.teacher as Teacher, id);
      const row = db
        .select()
        .from(schema.practiceChecks)
        .where(
          and(
            eq(schema.practiceChecks.sessionId, id),
            eq(schema.practiceChecks.studentId, studentId),
          ),
        )
        .get();
      const name = row?.submittedSha ? row.submittedName : row?.fileName;
      const sha = row?.submittedSha ?? row?.fileSha;
      const path = sha ? blobPath(app.ctx.config.dataDir, sha) : null;
      // On the platform the bytes may not have come up yet: the folder brings them later (H12).
      if (!name || !path || !existsSync(path)) throw notFound('Practice file');
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', attachmentHeader(name))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', 'sandbox')
        .header('Cache-Control', 'private, no-cache')
        .send(createReadStream(path));
    },
  );

  app.get('/journal/:classId', { preHandler: requireTeacher }, (request): Journal => {
    const { classId } = ClassParams.parse(request.params);
    requireClass(db, request.teacher as Teacher, classId);
    const journal = classJournal(db, content, classId);
    if (!journal) throw notFound('Class not found');
    return journal;
  });

  app.get('/journal/:classId/export.xlsx', { preHandler: requireTeacher }, (request, reply) => {
    const { classId } = ClassParams.parse(request.params);
    const { lang } = ExportQuery.parse(request.query);
    const teacher = request.teacher as Teacher;
    requireClass(db, teacher, classId);
    const journal = classJournal(db, content, classId);
    if (!journal) throw notFound('Class not found');
    const locale = lang ?? teacher.locale;
    const file = journalXlsx(journal, locale);
    request.log.info(
      { classId, lessons: journal.lessons.length, bytes: file.byteLength },
      'journal exported',
    );
    return reply
      .header('Content-Type', XLSX_MIME)
      .header(
        'Content-Disposition',
        `attachment; filename="${asciiFileName(journalFileName(journal, locale))}"`,
      )
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(file));
  });

  done();
};
