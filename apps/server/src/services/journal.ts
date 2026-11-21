import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  emaktabDue,
  type CreateJournalColumn,
  type EmaktabReminder,
  type Journal,
  type JournalSync,
  type SetEmaktab,
  type SetJournalCell,
} from '@sinf/shared';
import type { ContentStore } from '../content/index.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import { sessionResults, setSessionGrades } from './results.js';

/**
 * The journal by hand (PLAN.md 5.1; stage 4, W9): columns without a lesson, a grade, "н" or a note
 * in any cell, and the exchange of the teacher's columns with the platform both ways.
 */

type ColumnRow = typeof schema.journalColumns.$inferSelect;

export function createColumn(
  db: Db,
  classId: string,
  teacherId: string,
  input: CreateJournalColumn,
  now = new Date(),
): ColumnRow {
  const at = now.toISOString();
  const row: ColumnRow = {
    id: randomUUID(),
    classId,
    date: input.date,
    title: input.title,
    createdBy: teacherId,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    syncedAt: null,
  };
  db.insert(schema.journalColumns).values(row).run();
  return row;
}

function columnOf(db: Db, classId: string, columnId: string): ColumnRow {
  const row = db
    .select()
    .from(schema.journalColumns)
    .where(
      and(
        eq(schema.journalColumns.id, columnId),
        eq(schema.journalColumns.classId, classId),
        isNull(schema.journalColumns.deletedAt),
      ),
    )
    .get();
  if (!row) throw notFound('Column');
  return row;
}

/** A deleted column stays as a row until both sides know of it. */
export function deleteColumn(db: Db, classId: string, columnId: string, now = new Date()): void {
  columnOf(db, classId, columnId);
  const at = now.toISOString();
  db.update(schema.journalColumns)
    .set({ deletedAt: at, updatedAt: at, syncedAt: null })
    .where(eq(schema.journalColumns.id, columnId))
    .run();
}

/** One cell by hand. A lesson's cell takes a grade and a note; a teacher's column also "н". */
export function setCell(
  db: Db,
  content: ContentStore,
  classId: string,
  input: SetJournalCell,
  now = new Date(),
): void {
  const at = now.toISOString();
  const student = db
    .select()
    .from(schema.students)
    .where(eq(schema.students.id, input.studentId))
    .get();
  if (!student || student.classId !== classId) throw notFound('Student');

  if (input.column.kind === 'manual') {
    const column = columnOf(db, classId, input.column.columnId);
    const where = and(
      eq(schema.grades.columnId, column.id),
      eq(schema.grades.studentId, student.id),
    );
    const existing = db.select().from(schema.grades).where(where).get();
    const absent = input.absent ?? existing?.absent ?? false;
    // "н" and a grade do not go together: the newer of the two stands.
    const value = input.absent
      ? null
      : input.value !== undefined
        ? input.value
        : (existing?.value ?? null);
    const next = {
      value,
      absent: input.value != null ? false : absent,
      comment: input.comment !== undefined ? input.comment || null : (existing?.comment ?? null),
      updatedAt: at,
      syncedAt: null,
    };
    if (existing) {
      db.update(schema.grades).set(next).where(where).run();
    } else {
      db.insert(schema.grades)
        .values({
          id: randomUUID(),
          studentId: student.id,
          classId,
          sessionId: null,
          columnId: column.id,
          date: column.date,
          stars: 0,
          source: 'manual',
          createdAt: at,
          ...next,
        })
        .run();
    }
    return;
  }

  // A lesson's cell: the grade as on the results page (H10), and the note beside it.
  const sessionId = input.column.sessionId;
  const results = sessionResults(db, content, sessionId);
  if (!results || results.class.id !== classId) throw notFound('Lesson');
  if (input.absent !== undefined) {
    throw new ApiHttpError(400, 'absent_from_lesson', 'A lesson knows who came by itself');
  }
  if (input.value !== undefined) {
    setSessionGrades(
      db,
      content,
      sessionId,
      { grades: [{ studentId: student.id, value: input.value }] },
      now,
    );
  }
  if (input.comment !== undefined) {
    const row = results.rows.find((r) => r.studentId === student.id);
    if (!row?.present)
      throw new ApiHttpError(400, 'not_at_lesson', 'This student was not at the lesson');
    const where = and(
      eq(schema.grades.sessionId, sessionId),
      eq(schema.grades.studentId, student.id),
    );
    const existing = db.select().from(schema.grades).where(where).get();
    if (existing) {
      db.update(schema.grades)
        .set({ comment: input.comment || null })
        .where(where)
        .run();
    } else if (input.comment) {
      // A note without a confirmed grade: the suggestion still shows.
      db.insert(schema.grades)
        .values({
          id: randomUUID(),
          studentId: student.id,
          classId,
          sessionId,
          date: results.date,
          stars: row.totalStars,
          value: null,
          source: 'session',
          comment: input.comment,
          createdAt: at,
        })
        .run();
    }
    db.update(schema.sessions)
      .set({ syncedAt: null })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }
}

// ---------- the exchange of the teacher's columns (ADR-011, W9)

/** What this computer has to send: columns and grades changed since the platform last took them. */
export function pendingJournal(db: Db): JournalSync {
  const columns = db
    .select()
    .from(schema.journalColumns)
    .where(isNull(schema.journalColumns.syncedAt))
    .all();
  const grades = db
    .select()
    .from(schema.grades)
    .where(and(isNull(schema.grades.syncedAt), isNull(schema.grades.sessionId)))
    .all()
    .filter((g) => g.columnId && g.updatedAt);
  return {
    columns: columns.map((c) => ({
      id: c.id,
      classId: c.classId,
      date: c.date,
      title: c.title,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt,
    })),
    grades: grades.map((g) => ({
      columnId: g.columnId ?? '',
      studentId: g.studentId,
      value: g.value,
      absent: g.absent,
      comment: g.comment,
      updatedAt: g.updatedAt ?? g.createdAt,
    })),
  };
}

export function markJournalSynced(db: Db, sent: JournalSync, at = new Date().toISOString()): void {
  db.transaction((tx) => {
    for (const c of sent.columns) {
      tx.update(schema.journalColumns)
        .set({ syncedAt: at })
        .where(
          and(eq(schema.journalColumns.id, c.id), eq(schema.journalColumns.updatedAt, c.updatedAt)),
        )
        .run();
    }
    for (const g of sent.grades) {
      tx.update(schema.grades)
        .set({ syncedAt: at })
        .where(
          and(
            eq(schema.grades.columnId, g.columnId),
            eq(schema.grades.studentId, g.studentId),
            eq(schema.grades.updatedAt, g.updatedAt),
          ),
        )
        .run();
    }
  });
}

/** The teacher's columns of these classes, deleted ones too: the other side must hear of them. */
export function journalOfClasses(db: Db, classIds: string[]): JournalSync {
  if (classIds.length === 0) return { columns: [], grades: [] };
  const columns = db
    .select()
    .from(schema.journalColumns)
    .where(inArray(schema.journalColumns.classId, classIds))
    .all();
  const grades = columns.length
    ? db
        .select()
        .from(schema.grades)
        .where(
          inArray(
            schema.grades.columnId,
            columns.map((c) => c.id),
          ),
        )
        .all()
    : [];
  return {
    columns: columns.map((c) => ({
      id: c.id,
      classId: c.classId,
      date: c.date,
      title: c.title,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt,
    })),
    grades: grades.map((g) => ({
      columnId: g.columnId ?? '',
      studentId: g.studentId,
      value: g.value,
      absent: g.absent,
      comment: g.comment,
      updatedAt: g.updatedAt ?? g.createdAt,
    })),
  };
}

/**
 * Takes the other side's columns and grades: a newer change wins, an older one is ignored. Only
 * classes and children this side knows are touched (`allowedClasses`).
 */
export function applyJournal(
  db: Db,
  incoming: JournalSync,
  allowedClasses: ReadonlySet<string>,
  markSynced: boolean,
): number {
  let applied = 0;
  const syncedAt = markSynced ? new Date().toISOString() : null;
  db.transaction((tx) => {
    const classOfColumn = new Map<string, string>();
    for (const c of incoming.columns) {
      if (!allowedClasses.has(c.classId)) continue;
      const here = tx
        .select()
        .from(schema.journalColumns)
        .where(eq(schema.journalColumns.id, c.id))
        .get();
      if (here && here.classId !== c.classId) continue;
      classOfColumn.set(c.id, c.classId);
      if (here && here.updatedAt >= c.updatedAt) continue;
      const values = { ...c, syncedAt };
      tx.insert(schema.journalColumns)
        .values(values)
        .onConflictDoUpdate({ target: schema.journalColumns.id, set: values })
        .run();
      applied += 1;
    }
    for (const g of incoming.grades) {
      const classId =
        classOfColumn.get(g.columnId) ??
        tx
          .select({ classId: schema.journalColumns.classId })
          .from(schema.journalColumns)
          .where(eq(schema.journalColumns.id, g.columnId))
          .get()?.classId;
      if (!classId || !allowedClasses.has(classId)) continue;
      const student = tx
        .select()
        .from(schema.students)
        .where(eq(schema.students.id, g.studentId))
        .get();
      if (!student || student.classId !== classId) continue;
      const where = and(
        eq(schema.grades.columnId, g.columnId),
        eq(schema.grades.studentId, g.studentId),
      );
      const here = tx.select().from(schema.grades).where(where).get();
      if (here && (here.updatedAt ?? '') >= g.updatedAt) continue;
      const column = tx
        .select({ date: schema.journalColumns.date })
        .from(schema.journalColumns)
        .where(eq(schema.journalColumns.id, g.columnId))
        .get();
      const set = {
        value: g.value,
        absent: g.absent,
        comment: g.comment,
        updatedAt: g.updatedAt,
        syncedAt,
      };
      if (here) {
        tx.update(schema.grades).set(set).where(where).run();
      } else {
        tx.insert(schema.grades)
          .values({
            id: randomUUID(),
            studentId: g.studentId,
            classId,
            sessionId: null,
            columnId: g.columnId,
            date: column?.date ?? g.updatedAt.slice(0, 10),
            stars: 0,
            source: 'manual',
            createdAt: g.updatedAt,
            ...set,
          })
          .run();
      }
      applied += 1;
    }
  });
  return applied;
}

// ---------- moving grades to eMaktab (PLAN.md 5.4; W12)

/** Marks a column of the journal as moved to eMaktab, or takes the mark back. */
export function setEmaktab(
  db: Db,
  journal: Journal,
  teacherId: string,
  input: SetEmaktab,
  now = new Date(),
): void {
  const columnId = input.column.kind === 'lesson' ? input.column.sessionId : input.column.columnId;
  const known = journal.lessons.some((l) => (l.sessionId ?? l.columnId) === columnId);
  if (!known) throw notFound('Column');
  const where = and(
    eq(schema.emaktabMarks.classId, journal.class.id),
    eq(schema.emaktabMarks.columnId, columnId),
  );
  if (!input.done) {
    db.delete(schema.emaktabMarks).where(where).run();
    return;
  }
  if (db.select().from(schema.emaktabMarks).where(where).get()) return;
  db.insert(schema.emaktabMarks)
    .values({
      classId: journal.class.id,
      columnId,
      markedBy: teacherId,
      markedAt: now.toISOString(),
    })
    .run();
}

/** What waits to be moved in the teacher's classes, soonest deadline first. */
export function emaktabReminders(
  journals: readonly Journal[],
  now = new Date(),
): EmaktabReminder[] {
  return journals
    .flatMap((journal) =>
      emaktabDue(journal, now).map((due) => {
        const lesson = journal.lessons[due.index];
        return {
          classId: journal.class.id,
          className: journal.class.name,
          lessonTitle: lesson?.lessonTitle ?? '—',
          date: lesson?.date ?? '',
          grades: due.grades,
          hoursLeft: due.hoursLeft,
        };
      }),
    )
    .sort((a, b) => a.hoursLeft - b.hoursLeft);
}
