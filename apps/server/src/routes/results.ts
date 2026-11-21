import { createReadStream, existsSync } from 'node:fs';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  LocaleSchema,
  SetGradesSchema,
  SetPracticeMarksSchema,
  CreateJournalColumnSchema,
  JournalSyncSchema,
  SetJournalCellSchema,
  SetEmaktabSchema,
  ImportGradesSchema,
  type EmaktabRemindersResponse,
  type JournalSync,
  type Journal,
  type SessionResults,
  type Teacher,
} from '@sinf/shared';
import {
  requireClass,
  requireDevice,
  requireSessionClass,
  visibleClassWhere,
} from '../auth/access.js';
import {
  applyJournal,
  createColumn,
  deleteColumn,
  emaktabReminders,
  importGrades,
  journalOfClasses,
  setCell,
  setEmaktab,
} from '../services/journal.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
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

  /** eMaktab is online: its marks live on the platform, a school computer shows none (W12). */
  const onSchoolPc = (): boolean => app.sync?.link() != null;

  const journalOf = (classId: string): Journal => {
    const journal = classJournal(db, content, classId);
    if (!journal) throw notFound('Class not found');
    return onSchoolPc() ? { ...journal, emaktab: false } : journal;
  };

  app.get('/journal/:classId', { preHandler: requireTeacher }, (request): Journal => {
    const { classId } = ClassParams.parse(request.params);
    requireClass(db, request.teacher as Teacher, classId);
    return journalOf(classId);
  });

  // ---------- moving grades to eMaktab (PLAN.md 5.4; W12)

  app.put('/journal/:classId/emaktab', { preHandler: requireTeacher }, (request): Journal => {
    const { classId } = ClassParams.parse(request.params);
    const teacher = request.teacher as Teacher;
    requireClass(db, teacher, classId);
    if (onSchoolPc()) {
      throw new ApiHttpError(409, 'edit_on_platform', 'eMaktab marks are kept on the website');
    }
    setEmaktab(db, journalOf(classId), teacher.id, SetEmaktabSchema.parse(request.body));
    return journalOf(classId);
  });

  app.get(
    '/emaktab/reminders',
    { preHandler: requireTeacher },
    (request): EmaktabRemindersResponse => {
      if (onSchoolPc()) return { reminders: [] };
      const teacher = request.teacher as Teacher;
      // The classes this teacher grades: their own and those they teach, not the whole school's.
      const taught = db
        .select({ id: schema.classTeachers.classId })
        .from(schema.classTeachers)
        .where(eq(schema.classTeachers.userId, teacher.id))
        .all()
        .map((r) => r.id);
      const classIds = db
        .select({ id: schema.classes.id })
        .from(schema.classes)
        .where(
          and(
            visibleClassWhere(db, teacher.id),
            taught.length > 0
              ? or(eq(schema.classes.ownerId, teacher.id), inArray(schema.classes.id, taught))
              : eq(schema.classes.ownerId, teacher.id),
          ),
        )
        .all()
        .map((c) => c.id);
      const journals = classIds.flatMap((id) => classJournal(db, content, id) ?? []);
      return { reminders: emaktabReminders(journals) };
    },
  );

  // ---------- grades from a file (PLAN.md 5.5; W13)

  app.post('/journal/:classId/import', { preHandler: requireTeacher }, (request): Journal => {
    const { classId } = ClassParams.parse(request.params);
    const teacher = request.teacher as Teacher;
    requireClass(db, teacher, classId);
    const input = ImportGradesSchema.parse(request.body);
    const grades = importGrades(db, classId, teacher.id, input);
    request.log.info({ classId, columns: input.columns.length, grades }, 'grades imported');
    void app.sync?.push();
    return journalOf(classId);
  });

  // ---------- the journal by hand (W9)

  /** A column without a lesson: a test on paper, oral answers. */
  app.post('/journal/:classId/columns', { preHandler: requireTeacher }, (request): Journal => {
    const { classId } = ClassParams.parse(request.params);
    const teacher = request.teacher as Teacher;
    requireClass(db, teacher, classId);
    createColumn(db, classId, teacher.id, CreateJournalColumnSchema.parse(request.body));
    void app.sync?.push();
    return journalOf(classId);
  });

  app.delete(
    '/journal/:classId/columns/:columnId',
    { preHandler: requireTeacher },
    (request): Journal => {
      const { classId, columnId } = z
        .object({ classId: z.string().min(1), columnId: z.string().min(1) })
        .parse(request.params);
      requireClass(db, request.teacher as Teacher, classId);
      deleteColumn(db, classId, columnId);
      void app.sync?.push();
      return journalOf(classId);
    },
  );

  /** One cell: a grade, "н" in a column without a lesson, a note. */
  app.put('/journal/:classId/cell', { preHandler: requireTeacher }, (request): Journal => {
    const { classId } = ClassParams.parse(request.params);
    requireClass(db, request.teacher as Teacher, classId);
    setCell(db, content, classId, SetJournalCellSchema.parse(request.body));
    void app.sync?.push();
    return journalOf(classId);
  });

  // ---------- a school computer and the platform: the teacher's columns (ADR-011, W9)

  const schoolClasses = (schoolId: string): string[] =>
    db
      .select({ id: schema.classes.id })
      .from(schema.classes)
      .where(eq(schema.classes.schoolId, schoolId))
      .all()
      .map((c) => c.id);

  app.get('/sync/journal', async (request): Promise<JournalSync> => {
    const device = await requireDevice(db, request.headers.authorization);
    return journalOfClasses(db, schoolClasses(device.schoolId));
  });

  app.post(
    '/sync/journal',
    { bodyLimit: 8 * 1024 * 1024 },
    async (request): Promise<{ applied: number }> => {
      const device = await requireDevice(db, request.headers.authorization);
      const body = JournalSyncSchema.parse(request.body);
      const applied = applyJournal(db, body, new Set(schoolClasses(device.schoolId)), false);
      request.log.info(
        { columns: body.columns.length, grades: body.grades.length, applied },
        'journal received',
      );
      return { applied };
    },
  );

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
