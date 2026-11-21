import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type {
  LessonSyncBundle,
  LessonSyncResponse,
  ScreenshotSync,
  ScreenshotSyncResponse,
} from '@sinf/shared';
import { lessonDate } from '@sinf/shared';
import type { DeviceRow } from '../auth/access.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';

/**
 * A lesson arriving from a school computer (S2.6, ADR-011).
 *
 * Two rules make this safe to call again and again:
 *
 * 1. **Everything is written by primary key.** The ids were made where the lesson ran and never
 *    change, so sending the same lesson twice writes the same rows twice and the second write
 *    changes nothing. That is what lets the computer retry without bookkeeping.
 * 2. **Nothing is taken on trust.** The class must belong to the school of the device that sent it,
 *    the students must belong to that class, and the teacher must be a member of that school.
 *    Anything else answers 404, like everywhere else (ADR-009).
 */
export function receiveLessonBundle(
  db: Db,
  device: DeviceRow,
  bundle: LessonSyncBundle,
): LessonSyncResponse {
  const { session } = bundle;

  const cls = db.select().from(schema.classes).where(eq(schema.classes.id, session.classId)).get();
  if (!cls || cls.schoolId !== device.schoolId) throw notFound('Class');

  const member = db
    .select({ userId: schema.schoolMembers.userId })
    .from(schema.schoolMembers)
    .where(
      and(
        eq(schema.schoolMembers.schoolId, device.schoolId),
        eq(schema.schoolMembers.userId, session.teacherId),
      ),
    )
    .get();
  if (!member) throw notFound('Teacher');

  // A session id that already belongs to another school is not ours to overwrite.
  const existing = db
    .select({ classId: schema.sessions.classId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, session.id))
    .get();
  if (existing && existing.classId !== session.classId) {
    throw new ApiHttpError(409, 'session_conflict', 'This lesson belongs to another class');
  }

  const studentIds = [
    ...new Set([
      ...bundle.attendance.map((a) => a.studentId),
      ...bundle.screenResults.map((r) => r.studentId),
      ...bundle.practiceResults.map((r) => r.studentId),
      ...bundle.quizAttempts.map((a) => a.studentId),
      ...(bundle.grades ?? []).map((g) => g.studentId),
      ...(bundle.checks ?? []).map((c) => c.studentId),
    ]),
  ];
  if (studentIds.length > 0) {
    const known = db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(
        and(eq(schema.students.classId, session.classId), inArray(schema.students.id, studentIds)),
      )
      .all();
    if (known.length !== studentIds.length) throw notFound('Student');
  }

  db.transaction((tx) => {
    tx.insert(schema.sessions)
      .values({
        id: session.id,
        classId: session.classId,
        lessonId: session.lessonId,
        teacherId: session.teacherId,
        // The join code only matters while the lesson runs, and it ran elsewhere.
        joinCode: '',
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        syncedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.sessions.id,
        set: {
          status: session.status,
          endedAt: session.endedAt,
          syncedAt: new Date().toISOString(),
        },
      })
      .run();

    for (const row of bundle.attendance) {
      tx.insert(schema.attendance)
        .values({
          sessionId: session.id,
          studentId: row.studentId,
          status: row.status,
          joinedAt: row.joinedAt,
        })
        .onConflictDoUpdate({
          target: [schema.attendance.sessionId, schema.attendance.studentId],
          set: { status: row.status, joinedAt: row.joinedAt },
        })
        .run();
    }

    for (const row of bundle.screenResults) {
      tx.insert(schema.screenResults)
        .values({
          sessionId: session.id,
          studentId: row.studentId,
          screenIndex: row.screenIndex,
          stars: row.stars,
          attempts: row.attempts,
          firstAt: row.firstAt,
          lastAt: row.lastAt,
        })
        .onConflictDoUpdate({
          target: [
            schema.screenResults.sessionId,
            schema.screenResults.studentId,
            schema.screenResults.screenIndex,
          ],
          // A later send may carry more of the same lesson, never less: keep the better result.
          set: {
            stars: sql`max(${schema.screenResults.stars}, ${row.stars})`,
            attempts: sql`max(${schema.screenResults.attempts}, ${row.attempts})`,
            lastAt: row.lastAt,
          },
        })
        .run();
    }

    for (const row of bundle.practiceResults) {
      tx.insert(schema.practiceResults)
        .values({
          sessionId: session.id,
          studentId: row.studentId,
          stars: row.stars,
          stepsDone: row.stepsDone,
          at: row.at,
        })
        .onConflictDoUpdate({
          target: [schema.practiceResults.sessionId, schema.practiceResults.studentId],
          set: { stars: row.stars, stepsDone: row.stepsDone, at: row.at },
        })
        .run();
    }

    for (const row of bundle.quizAttempts) {
      tx.insert(schema.quizAttempts)
        .values({
          id: row.id,
          sessionId: session.id,
          studentId: row.studentId,
          questionIndex: row.questionIndex,
          optionIndex: row.optionIndex,
          correct: row.correct,
          timeMs: row.timeMs,
          points: row.points,
          at: row.at,
        })
        .onConflictDoNothing()
        .run();
    }

    // Grades: the list is the lesson's grades as they stand on the school computer (H10), so what
    // is not in it any more is taken away. A computer that sends no list knows no grades: leave them.
    if (bundle.grades) {
      const graded = bundle.grades.map((g) => g.studentId);
      tx.delete(schema.grades)
        .where(
          graded.length > 0
            ? and(
                eq(schema.grades.sessionId, session.id),
                notInArray(schema.grades.studentId, graded),
              )
            : eq(schema.grades.sessionId, session.id),
        )
        .run();
      for (const row of bundle.grades) {
        tx.insert(schema.grades)
          .values({
            id: randomUUID(),
            studentId: row.studentId,
            classId: session.classId,
            sessionId: session.id,
            date: lessonDate(session.startedAt),
            stars: row.stars,
            value: row.value,
            source: row.source,
            createdAt: row.at,
            comment: row.comment ?? null,
          })
          .onConflictDoUpdate({
            target: [schema.grades.sessionId, schema.grades.studentId],
            set: {
              value: row.value,
              source: row.source,
              stars: row.stars,
              createdAt: row.at,
              ...(row.comment !== undefined ? { comment: row.comment } : {}),
            },
          })
          .run();
      }
    }

    // Practice files (H16): the lesson's list as it stands on the school computer, like the grades.
    if (bundle.checks) {
      tx.delete(schema.practiceChecks).where(eq(schema.practiceChecks.sessionId, session.id)).run();
      for (const c of bundle.checks) {
        tx.insert(schema.practiceChecks)
          .values({
            sessionId: session.id,
            studentId: c.studentId,
            fileName: c.fileName,
            fileSha: c.fileSha,
            report: c.report,
            checkedAt: c.checkedAt,
            marks: c.marks,
            ...(c.submittedAt
              ? {
                  submittedName: c.fileName,
                  submittedSha: c.fileSha,
                  submittedReport: c.report,
                  submittedAt: c.submittedAt,
                }
              : {}),
          })
          .run();
      }
    }
  });

  return {
    ok: true,
    sessionId: session.id,
    counts: {
      attendance: bundle.attendance.length,
      screenResults: bundle.screenResults.length,
      practiceResults: bundle.practiceResults.length,
      quizAttempts: bundle.quizAttempts.length,
    },
  };
}

/** A JPEG file starts with these three bytes. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const MAX_JPEG_BYTES = 420 * 1024;

/**
 * A screenshot arriving from a school computer (H10). The same two rules as for a lesson: written
 * by its own id, so a second send stores nothing new; and nothing on trust — the lesson must already
 * be here and belong to the device's school, the child must be of that lesson's class.
 */
export function receiveScreenshot(
  db: Db,
  dataDir: string,
  device: DeviceRow,
  shot: ScreenshotSync,
): ScreenshotSyncResponse {
  const session = db
    .select({ classId: schema.sessions.classId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, shot.sessionId))
    .get();
  if (!session) throw notFound('Session');
  const cls = db.select().from(schema.classes).where(eq(schema.classes.id, session.classId)).get();
  if (!cls || cls.schoolId !== device.schoolId) throw notFound('Session');
  const student = db
    .select({ classId: schema.students.classId })
    .from(schema.students)
    .where(eq(schema.students.id, shot.studentId))
    .get();
  if (!student || student.classId !== session.classId) throw notFound('Student');

  const existing = db
    .select({ sessionId: schema.screenshots.sessionId })
    .from(schema.screenshots)
    .where(eq(schema.screenshots.id, shot.id))
    .get();
  if (existing) {
    if (existing.sessionId !== shot.sessionId) {
      throw new ApiHttpError(409, 'screenshot_conflict', 'This picture belongs to another lesson');
    }
    return { ok: true, id: shot.id };
  }

  const bytes = Buffer.from(shot.jpeg, 'base64');
  if (bytes.length > MAX_JPEG_BYTES || !JPEG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new ApiHttpError(400, 'bad_image', 'A screenshot is a JPEG of at most 400 KB');
  }
  // The id is a UUID (checked by the schema), so it is safe as a file name.
  const fileKey = `screenshots/${shot.sessionId}/${shot.id}.jpg`;
  const path = join(dataDir, fileKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  db.insert(schema.screenshots)
    .values({
      id: shot.id,
      sessionId: shot.sessionId,
      studentId: shot.studentId,
      kind: shot.kind,
      takenAt: shot.takenAt,
      fileKey,
      width: shot.width,
      height: shot.height,
      bytes: bytes.length,
      syncedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
  return { ok: true, id: shot.id };
}
