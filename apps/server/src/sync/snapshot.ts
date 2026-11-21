import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { SchoolSnapshot } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { schoolSettings } from '../services/school-settings.js';

/**
 * The roster of one school as the platform hands it to a school computer (S2.6, ADR-011).
 *
 * Identifiers are carried through unchanged: the lesson on that computer is then about the very
 * students the platform knows, and its results can be written back by primary key.
 *
 * What is deliberately **not** here: password hashes of teachers. A school computer stands in a
 * classroom and may be stolen; what it carries must be enough to run a lesson offline and no more.
 * Students' code hashes do travel, because a child logs in by code with no internet at all (S1.7).
 */
export function buildSchoolSnapshot(db: Db, schoolId: string): SchoolSnapshot | null {
  const school = db.select().from(schema.schools).where(eq(schema.schools.id, schoolId)).get();
  if (!school) return null;

  const members = db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      fullName: schema.users.fullName,
      locale: schema.users.locale,
      role: schema.schoolMembers.role,
    })
    .from(schema.schoolMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.schoolMembers.userId))
    .where(eq(schema.schoolMembers.schoolId, schoolId))
    .orderBy(schema.users.id)
    .all();

  const classRows = db
    .select()
    .from(schema.classes)
    .where(eq(schema.classes.schoolId, schoolId))
    .orderBy(schema.classes.id)
    .all();
  const classIds = classRows.map((c) => c.id);

  const teacherLinks =
    classIds.length > 0
      ? db
          .select()
          .from(schema.classTeachers)
          .where(inArray(schema.classTeachers.classId, classIds))
          .orderBy(schema.classTeachers.userId)
          .all()
      : [];

  const studentRows =
    classIds.length > 0
      ? db
          .select()
          .from(schema.students)
          .where(inArray(schema.students.classId, classIds))
          .orderBy(schema.students.id)
          .all()
      : [];

  // The programmes the school's classes follow (W7): the school computer says "next lesson" too.
  const programIds = [...new Set(classRows.flatMap((c) => (c.programId ? [c.programId] : [])))];
  const programRows =
    programIds.length > 0
      ? db
          .select()
          .from(schema.programs)
          .where(and(inArray(schema.programs.id, programIds), isNull(schema.programs.deletedAt)))
          .orderBy(schema.programs.id)
          .all()
      : [];

  const snapshot: Omit<SchoolSnapshot, 'version'> = {
    school: { id: school.id, name: school.name, city: school.city },
    settings: schoolSettings(school),
    teachers: members,
    classes: classRows.map((c) => ({
      id: c.id,
      ownerId: c.ownerId,
      name: c.name,
      grade: c.grade,
      academicYear: c.academicYear,
      settings: c.settings,
      teacherIds: teacherLinks.filter((l) => l.classId === c.id).map((l) => l.userId),
      homeCode: c.homeCode,
      programId: c.programId,
    })),
    students: studentRows.map((s) => ({
      id: s.id,
      classId: s.classId,
      firstName: s.firstName,
      lastName: s.lastName,
      codeKind: s.codeKind,
      codeHash: s.codeHash,
      codePublic: s.codePublic,
      isActive: s.isActive,
      sortOrder: s.sortOrder,
    })),
    programs: programRows.map((p) => ({
      id: p.id,
      ownerId: p.ownerId,
      title: p.title,
      grade: p.grade,
      items: p.items,
      version: p.version,
      updatedAt: p.updatedAt,
    })),
  };

  // Everything is ordered by id above, so the same roster always hashes to the same version and a
  // computer that already holds it writes nothing.
  const version = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  return { ...snapshot, version };
}
