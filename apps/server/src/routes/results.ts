import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { LocaleSchema, type Journal, type SessionResults, type Teacher } from '@sinf/shared';
import { requireClass, requireSessionClass } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { notFound } from '../errors.js';
import { journalFileName, journalXlsx } from '../services/journal-export.js';
import { classJournal, sessionResults } from '../services/results.js';
import { XLSX_MIME } from '../services/xlsx.js';

const SessionParams = z.object({ id: z.string().min(1) });
const ClassParams = z.object({ classId: z.string().min(1) });
const ExportQuery = z.object({ lang: LocaleSchema.optional() });

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
