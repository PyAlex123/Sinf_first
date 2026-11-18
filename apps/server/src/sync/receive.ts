import { and, eq, inArray, sql } from 'drizzle-orm';
import type { LessonSyncBundle, LessonSyncResponse } from '@sinf/shared';
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
