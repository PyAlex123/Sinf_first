import { and, eq, isNull, lt, or } from 'drizzle-orm';
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
  const quizAttempts = db
    .select()
    .from(schema.quizAttempts)
    .where(eq(schema.quizAttempts.sessionId, sessionId))
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
  };
}

export function markSynced(db: Db, sessionId: string, at = new Date().toISOString()): void {
  db.update(schema.sessions).set({ syncedAt: at }).where(eq(schema.sessions.id, sessionId)).run();
}
