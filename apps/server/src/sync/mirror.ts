import { eq, inArray, notInArray, and } from 'drizzle-orm';
import type { SchoolSnapshot } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { mirrorLicense } from '../services/licenses.js';

/**
 * Writing the school's roster into this computer's own database (S2.6, ADR-011).
 *
 * The platform's identifiers are kept, so a lesson held here is about the school's real children and
 * its results can go back where they belong. Nothing is ever deleted: a student who left the class
 * is marked inactive instead, because rows of past lessons point at them, and a class that
 * disappeared upstream stays as local history.
 *
 * Teachers arrive without a password hash (snapshot.ts says why). They get a placeholder that no
 * password can match; the real one is remembered the first time that teacher logs in here through
 * the platform (routes/auth.ts).
 */
export interface MirrorResult {
  classes: number;
  students: number;
  teachers: number;
  deactivated: number;
}

/** A hash no password produces: this row cannot be logged into until the platform has vouched once. */
const NO_PASSWORD = 'platform-only';

export function applySchoolSnapshot(db: Db, snapshot: SchoolSnapshot): MirrorResult {
  const now = new Date().toISOString();
  let deactivated = 0;

  db.transaction((tx) => {
    tx.insert(schema.schools)
      .values({
        id: snapshot.school.id,
        name: snapshot.school.name,
        city: snapshot.school.city,
        settings: snapshot.settings ?? {},
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: schema.schools.id,
        // The school's rules come down with the roster (A1): quotas, programs, keeping works.
        set: {
          name: snapshot.school.name,
          city: snapshot.school.city,
          ...(snapshot.settings ? { settings: snapshot.settings } : {}),
        },
      })
      .run();

    for (const teacher of snapshot.teachers) {
      tx.insert(schema.users)
        .values({
          id: teacher.id,
          role: teacher.role === 'admin' ? 'school_admin' : 'teacher',
          email: teacher.email,
          passwordHash: NO_PASSWORD,
          fullName: teacher.fullName,
          locale: teacher.locale,
          createdAt: now,
        })
        // The local password hash is left alone on purpose: it is this computer's memory of a
        // successful login and the only way the teacher gets in with no internet.
        .onConflictDoUpdate({
          target: schema.users.id,
          set: {
            email: teacher.email,
            fullName: teacher.fullName,
            locale: teacher.locale,
            role: teacher.role === 'admin' ? 'school_admin' : 'teacher',
          },
        })
        .run();
      tx.insert(schema.schoolMembers)
        .values({
          schoolId: snapshot.school.id,
          userId: teacher.id,
          role: teacher.role,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.schoolMembers.schoolId, schema.schoolMembers.userId],
          set: { role: teacher.role },
        })
        .run();
    }

    // Membership that is gone upstream goes too: it grants access, and access must not outlive it.
    const teacherIds = snapshot.teachers.map((t) => t.id);
    tx.delete(schema.schoolMembers)
      .where(
        teacherIds.length > 0
          ? and(
              eq(schema.schoolMembers.schoolId, snapshot.school.id),
              notInArray(schema.schoolMembers.userId, teacherIds),
            )
          : eq(schema.schoolMembers.schoolId, snapshot.school.id),
      )
      .run();

    // Programmes first: a class names one (W7). Read-only copies, written whole; one whose author
    // is not a teacher here (a public one from another school) is not kept.
    const knownTeacher = (id: string): boolean =>
      !!tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).get();
    for (const program of snapshot.programs ?? []) {
      if (!knownTeacher(program.ownerId)) continue;
      const values = {
        ...program,
        visibility: 'private' as const,
        sourceId: null,
        createdAt: program.updatedAt,
        deletedAt: null,
      };
      tx.insert(schema.programs)
        .values(values)
        .onConflictDoUpdate({ target: schema.programs.id, set: values })
        .run();
    }

    for (const cls of snapshot.classes) {
      tx.insert(schema.classes)
        .values({
          id: cls.id,
          schoolId: snapshot.school.id,
          ownerId: cls.ownerId,
          name: cls.name,
          grade: cls.grade,
          academicYear: cls.academicYear,
          settings: cls.settings,
          createdAt: now,
          homeCode: cls.homeCode ?? null,
          programId: cls.programId ?? null,
        })
        .onConflictDoUpdate({
          target: schema.classes.id,
          set: {
            schoolId: snapshot.school.id,
            ownerId: cls.ownerId,
            name: cls.name,
            grade: cls.grade,
            academicYear: cls.academicYear,
            settings: cls.settings,
            // The platform's code is the one on the cards; an older platform sends none.
            ...(cls.homeCode !== undefined ? { homeCode: cls.homeCode } : {}),
            ...(cls.programId !== undefined ? { programId: cls.programId } : {}),
          },
        })
        .run();
      for (const userId of cls.teacherIds) {
        tx.insert(schema.classTeachers)
          .values({ classId: cls.id, userId, createdAt: now })
          .onConflictDoNothing()
          .run();
      }
      tx.delete(schema.classTeachers)
        .where(
          cls.teacherIds.length > 0
            ? and(
                eq(schema.classTeachers.classId, cls.id),
                notInArray(schema.classTeachers.userId, cls.teacherIds),
              )
            : eq(schema.classTeachers.classId, cls.id),
        )
        .run();
    }

    for (const student of snapshot.students) {
      tx.insert(schema.students)
        .values({
          id: student.id,
          classId: student.classId,
          firstName: student.firstName,
          lastName: student.lastName,
          codeKind: student.codeKind,
          codeHash: student.codeHash,
          codePublic: student.codePublic,
          isVirtual: false,
          isActive: student.isActive,
          sortOrder: student.sortOrder,
        })
        .onConflictDoUpdate({
          target: schema.students.id,
          set: {
            classId: student.classId,
            firstName: student.firstName,
            lastName: student.lastName,
            codeKind: student.codeKind,
            codeHash: student.codeHash,
            codePublic: student.codePublic,
            isActive: student.isActive,
            sortOrder: student.sortOrder,
          },
        })
        .run();
    }

    // A student the school removed stops being offered at login but keeps their past lessons.
    const classIds = snapshot.classes.map((c) => c.id);
    const studentIds = snapshot.students.map((s) => s.id);
    if (classIds.length > 0) {
      const stale = tx
        .select({ id: schema.students.id })
        .from(schema.students)
        .where(
          studentIds.length > 0
            ? and(
                inArray(schema.students.classId, classIds),
                notInArray(schema.students.id, studentIds),
                eq(schema.students.isActive, true),
              )
            : and(inArray(schema.students.classId, classIds), eq(schema.students.isActive, true)),
        )
        .all();
      if (stale.length > 0) {
        tx.update(schema.students)
          .set({ isActive: false })
          .where(
            inArray(
              schema.students.id,
              stale.map((s) => s.id),
            ),
          )
          .run();
        deactivated = stale.length;
      }
    }
  });

  // What the school paid for (B2): an older platform sends nothing, and the copy stays as it was.
  if (snapshot.license !== undefined) mirrorLicense(db, snapshot.school.id, snapshot.license);

  return {
    classes: snapshot.classes.length,
    students: snapshot.students.length,
    teachers: snapshot.teachers.length,
    deactivated,
  };
}
