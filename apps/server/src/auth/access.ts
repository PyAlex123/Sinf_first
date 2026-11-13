import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { Teacher } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

/**
 * Who may see what (ADR-009). Every route that touches a class, a student or a lesson session goes
 * through this module — a route that queries those tables directly is a bug.
 *
 * A class belongs either to a school (`schoolId`) or personally to a teacher (`ownerId`, no school).
 * A teacher reaches a class when they own it, teach it (`class_teachers`) or belong to its school.
 *
 * Something the user may not see answers 404, never 403: 403 would confirm that the id exists.
 */

export type ClassRow = typeof schema.classes.$inferSelect;

function notFound(what: string): ApiHttpError {
  return new ApiHttpError(404, 'not_found', `${what} not found`);
}

/** Ids of the schools the user belongs to. */
export function schoolsOf(db: Db, userId: string): string[] {
  return db
    .select({ schoolId: schema.schoolMembers.schoolId })
    .from(schema.schoolMembers)
    .where(eq(schema.schoolMembers.userId, userId))
    .all()
    .map((row) => row.schoolId);
}

/** Condition "this teacher may see this class", for use inside a larger query. */
export function visibleClassWhere(db: Db, userId: string): SQL {
  const schools = schoolsOf(db, userId);
  const taught = db
    .select({ classId: schema.classTeachers.classId })
    .from(schema.classTeachers)
    .where(eq(schema.classTeachers.userId, userId))
    .all()
    .map((row) => row.classId);

  const conditions: SQL[] = [eq(schema.classes.ownerId, userId)];
  if (schools.length > 0) {
    conditions.push(inArray(schema.classes.schoolId, schools));
  }
  if (taught.length > 0) {
    conditions.push(inArray(schema.classes.id, taught));
  }
  // `or` of a non-empty list is always defined.
  return or(...conditions) as SQL;
}

/** The class, or 404 when it does not exist or belongs to somebody else. */
export function requireClass(db: Db, teacher: Teacher, classId: string): ClassRow {
  const row = db
    .select()
    .from(schema.classes)
    .where(and(eq(schema.classes.id, classId), visibleClassWhere(db, teacher.id)))
    .get();
  if (!row) throw notFound('Class');
  return row;
}

/** The student together with their class, or 404 when the teacher may not see that class. */
export function requireStudent(
  db: Db,
  teacher: Teacher,
  studentId: string,
): { student: typeof schema.students.$inferSelect; class: ClassRow } {
  const student = db.select().from(schema.students).where(eq(schema.students.id, studentId)).get();
  if (!student) throw notFound('Student');
  return { student, class: requireClass(db, teacher, student.classId) };
}

/** The lesson session, or 404 when it belongs to a class the teacher may not see. */
export function requireSessionClass(db: Db, teacher: Teacher, sessionId: string): ClassRow {
  const session = db
    .select({ classId: schema.sessions.classId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!session) throw notFound('Session');
  return requireClass(db, teacher, session.classId);
}
