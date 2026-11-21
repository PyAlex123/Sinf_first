import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { LessonSyncBundle } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';

/**
 * The queue of lessons waiting for a connection (S2.6).
 *
 * There is no queue table: the queue is `sessions.synced_at` being empty. A row cannot be lost, a
 * crash in the middle of a lesson cannot corrupt it, and the bundle is built from the database at
 * the moment of sending, so it is always the freshest version of what happened.
 */

/** A lesson nobody ended — the computer was switched off mid-lesson. After this it is sent anyway. */
export const ABANDONED_AFTER_MS = 12 * 60 * 60 * 1000;

export function pendingSessionIds(db: Db, now = Date.now(), limit = 20): string[] {
  const abandoned = new Date(now - ABANDONED_AFTER_MS).toISOString();
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        isNull(schema.sessions.syncedAt),
        or(eq(schema.sessions.status, 'ended'), lt(schema.sessions.startedAt, abandoned)),
      ),
    )
    .orderBy(schema.sessions.startedAt)
    .limit(limit)
    .all()
    .map((r) => r.id);
}

export function countPending(db: Db, now = Date.now()): number {
  return pendingSessionIds(db, now, 1000).length;
}

export function buildLessonBundle(db: Db, sessionId: string): LessonSyncBundle | null {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!session) return null;

  const attendance = db
    .select()
    .from(schema.attendance)
    .where(eq(schema.attendance.sessionId, sessionId))
    .all();
  const screenResults = db
    .select()
    .from(schema.screenResults)
    .where(eq(schema.screenResults.sessionId, sessionId))
    .all();
  const practiceResults = db
    .select()
    .from(schema.practiceResults)
    .where(eq(schema.practiceResults.sessionId, sessionId))
    .all();
  const quizAttempts = db
    .select()
    .from(schema.quizAttempts)
    .where(eq(schema.quizAttempts.sessionId, sessionId))
    .all();

  const grades = db
    .select()
    .from(schema.grades)
    .where(eq(schema.grades.sessionId, sessionId))
    .all();

  return {
    session: {
      id: session.id,
      classId: session.classId,
      lessonId: session.lessonId,
      teacherId: session.teacherId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
    },
    attendance: attendance.map((a) => ({
      studentId: a.studentId,
      status: a.status,
      joinedAt: a.joinedAt,
    })),
    screenResults: screenResults.map((r) => ({
      studentId: r.studentId,
      screenIndex: r.screenIndex,
      stars: r.stars,
      attempts: r.attempts,
      firstAt: r.firstAt,
      lastAt: r.lastAt,
    })),
    practiceResults: practiceResults.map((p) => ({
      studentId: p.studentId,
      stars: p.stars,
      stepsDone: p.stepsDone,
      at: p.at,
    })),
    quizAttempts: quizAttempts.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      questionIndex: a.questionIndex,
      optionIndex: a.optionIndex,
      correct: a.correct,
      timeMs: a.timeMs,
      points: a.points,
      at: a.at,
    })),
    grades: grades.flatMap((g) =>
      g.value !== null && g.value >= 2 && g.value <= 5
        ? [
            {
              studentId: g.studentId,
              value: g.value,
              source: g.source,
              stars: g.stars,
              at: g.createdAt,
            },
          ]
        : [],
    ),
  };
}

export function markSynced(db: Db, sessionId: string, at = new Date().toISOString()): void {
  db.update(schema.sessions).set({ syncedAt: at }).where(eq(schema.sessions.id, sessionId)).run();
}

/**
 * Screenshots waiting to go up (H10): only of lessons the platform already has — a picture of a
 * lesson it does not know would be refused — and only of lessons that are over, so nothing is sent
 * while the class is working (CLAUDE.md §3.1: "in the background, after the lesson").
 */
export function pendingScreenshots(db: Db, limit = 30) {
  return db
    .select({
      id: schema.screenshots.id,
      sessionId: schema.screenshots.sessionId,
      studentId: schema.screenshots.studentId,
      kind: schema.screenshots.kind,
      takenAt: schema.screenshots.takenAt,
      fileKey: schema.screenshots.fileKey,
      width: schema.screenshots.width,
      height: schema.screenshots.height,
    })
    .from(schema.screenshots)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.screenshots.sessionId))
    .where(
      and(
        isNull(schema.screenshots.syncedAt),
        isNotNull(schema.sessions.syncedAt),
        eq(schema.sessions.status, 'ended'),
      ),
    )
    .orderBy(schema.screenshots.takenAt)
    .limit(limit)
    .all();
}

export function countPendingScreenshots(db: Db): number {
  return db
    .select({ id: schema.screenshots.id })
    .from(schema.screenshots)
    .where(isNull(schema.screenshots.syncedAt))
    .all().length;
}

export function markScreenshotSynced(db: Db, id: string, at = new Date().toISOString()): void {
  db.update(schema.screenshots).set({ syncedAt: at }).where(eq(schema.screenshots.id, id)).run();
}
