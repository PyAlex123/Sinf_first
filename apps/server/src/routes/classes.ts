import { randomUUID } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  AddStudentsSchema,
  CreateClassSchema,
  MAX_STUDENTS_PER_CLASS,
  UpdateStudentSchema,
  type AddStudentsResponse,
  type ClassDetailsResponse,
  type ClassSettings,
  type ClassSummary,
  type Student,
  type StudentCodeResponse,
  type Teacher,
} from '@sinf/shared';
import { requireClass, requireStudent, schoolsOf, type ClassRow } from '../auth/access.js';
import { hashSecretSync } from '../auth/password.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError } from '../errors.js';
import {
  DEFAULT_CODE_PICS,
  randomDigitCode,
  randomPictureCode,
  splitCode,
} from '../services/codes.js';

const Params = z.object({ id: z.string().min(1) });

type StudentRow = typeof schema.students.$inferSelect;

/** Same name twice in a class is a mistake, whatever the letter case. */
function nameKey(name: { lastName: string; firstName: string }): string {
  return `${name.lastName.toLowerCase()}|${name.firstName.toLowerCase()}`;
}

function toStudent(row: StudentRow): Student {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    codeKind: row.codeKind,
    code: splitCode(row.codeKind, row.codePublic),
  };
}

/** "2025/2026": a school year starts in September, so before September it is the previous one. */
export function currentAcademicYear(now = new Date()): string {
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}/${start + 1}`;
}

/** Picture codes for the youngest, digits from the third grade on (services/codes.ts). */
function codeKindFor(grade: number): 'pics' | 'digits' {
  return grade <= 2 ? 'pics' : 'digits';
}

/** Surname, then first name — the order of the class register and of the printed cards. */
function byName(
  a: { lastName: string; firstName: string },
  b: { lastName: string; firstName: string },
): number {
  return a.lastName.localeCompare(b.lastName, 'ru') || a.firstName.localeCompare(b.firstName, 'ru');
}

/** Class details and student codes for the teacher (S1.6); creating classes and rosters (S2.2). */
export const classRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db } = app.ctx;

  const studentsOf = (classId: string): StudentRow[] =>
    db
      .select()
      .from(schema.students)
      .where(eq(schema.students.classId, classId))
      .orderBy(schema.students.sortOrder)
      .all();

  const schoolNameOf = (schoolId: string | null): string | null =>
    schoolId
      ? (db.select().from(schema.schools).where(eq(schema.schools.id, schoolId)).get()?.name ??
        null)
      : null;

  const summaryOf = (cls: ClassRow, studentCount: number): ClassSummary => ({
    id: cls.id,
    name: cls.name,
    grade: cls.grade,
    academicYear: cls.academicYear,
    settings: cls.settings,
    studentCount,
    schoolId: cls.schoolId,
    schoolName: schoolNameOf(cls.schoolId),
  });

  const details = (cls: ClassRow): ClassDetailsResponse => {
    const students = studentsOf(cls.id);
    return { class: summaryOf(cls, students.length), students: students.map(toStudent) };
  };

  /** Keeps the register in alphabetical order after every change (S2.2). */
  const renumber = (classId: string): void => {
    const rows = [...studentsOf(classId)].sort(byName);
    db.transaction((tx) => {
      rows.forEach((row, i) => {
        if (row.sortOrder !== i + 1) {
          tx.update(schema.students)
            .set({ sortOrder: i + 1 })
            .where(eq(schema.students.id, row.id))
            .run();
        }
      });
    });
  };

  app.get('/classes/:id', { preHandler: requireTeacher }, (request): ClassDetailsResponse => {
    const { id } = Params.parse(request.params);
    return details(requireClass(db, request.teacher as Teacher, id));
  });

  app.post('/classes', { preHandler: requireTeacher }, (request): { class: ClassSummary } => {
    const body = CreateClassSchema.parse(request.body);
    const teacher = request.teacher as Teacher;
    // A class of a school the teacher belongs to, or a personal one when they belong to none (ADR-009).
    const schools = schoolsOf(db, teacher.id);
    let schoolId: string | null = null;
    if (body.schoolId) {
      if (!schools.includes(body.schoolId))
        throw new ApiHttpError(404, 'not_found', 'School not found');
      schoolId = body.schoolId;
    } else if (schools.length === 1) {
      schoolId = schools[0] as string;
    } else if (schools.length > 1) {
      throw new ApiHttpError(400, 'school_required', 'Choose the school for this class');
    }
    const settings: ClassSettings = {
      starsToGrade: body.grade >= 3,
      codePics: [...DEFAULT_CODE_PICS],
    };
    const row = {
      id: randomUUID(),
      schoolId,
      ownerId: teacher.id,
      name: body.name,
      grade: body.grade,
      academicYear: body.academicYear ?? currentAcademicYear(),
      settings,
      createdAt: new Date().toISOString(),
    };
    db.transaction((tx) => {
      tx.insert(schema.classes).values(row).run();
      tx.insert(schema.classTeachers)
        .values({ classId: row.id, userId: teacher.id, createdAt: row.createdAt })
        .run();
    });
    request.log.info({ classId: row.id, schoolId }, 'class created');
    return { class: summaryOf(row, 0) };
  });

  /** Adds a pasted roster. Names already in the class are skipped, never duplicated. */
  app.post(
    '/classes/:id/students',
    { preHandler: requireTeacher },
    (request): AddStudentsResponse => {
      const { id } = Params.parse(request.params);
      const body = AddStudentsSchema.parse(request.body);
      const cls = requireClass(db, request.teacher as Teacher, id);
      const existing = studentsOf(cls.id);
      const have = new Set(existing.map((s) => nameKey(s)));
      const skipped: string[] = [];
      const fresh: { lastName: string; firstName: string }[] = [];
      for (const name of body.students) {
        if (have.has(nameKey(name))) {
          skipped.push(`${name.lastName} ${name.firstName}`);
          continue;
        }
        have.add(nameKey(name));
        fresh.push(name);
      }
      if (existing.length + fresh.length > MAX_STUDENTS_PER_CLASS) {
        throw new ApiHttpError(
          400,
          'class_full',
          `A class holds at most ${MAX_STUDENTS_PER_CLASS} students`,
          { limit: MAX_STUDENTS_PER_CLASS, current: existing.length, adding: fresh.length },
        );
      }
      if (fresh.length > 0) {
        const kind = codeKindFor(cls.grade);
        const taken = new Set(existing.map((s) => s.codePublic));
        const rows = fresh.map((name, i) => {
          const code =
            kind === 'pics'
              ? randomPictureCode(cls.settings.codePics, taken)
              : randomDigitCode(taken);
          taken.add(code);
          return {
            id: randomUUID(),
            classId: cls.id,
            firstName: name.firstName,
            lastName: name.lastName,
            codeKind: kind,
            codeHash: hashSecretSync(code),
            codePublic: code,
            isVirtual: false,
            isActive: true,
            sortOrder: existing.length + i + 1,
          };
        });
        db.insert(schema.students).values(rows).run();
        renumber(cls.id);
      }
      request.log.info(
        { classId: cls.id, added: fresh.length, skipped: skipped.length },
        'roster added',
      );
      return { ...details(cls), added: fresh.length, skipped };
    },
  );

  /** Fixes a misspelled name; the code and the card stay as they are. */
  app.patch('/students/:id', { preHandler: requireTeacher }, (request): ClassDetailsResponse => {
    const { id } = Params.parse(request.params);
    const body = UpdateStudentSchema.parse(request.body);
    const { student, class: cls } = requireStudent(db, request.teacher as Teacher, id);
    db.update(schema.students)
      .set({
        lastName: body.lastName ?? student.lastName,
        firstName: body.firstName ?? student.firstName,
      })
      .where(eq(schema.students.id, id))
      .run();
    renumber(cls.id);
    return details(cls);
  });

  /**
   * Removes a student. One who already took part in a lesson is only switched off, so the register and
   * the results of past lessons keep making sense.
   */
  app.delete('/students/:id', { preHandler: requireTeacher }, (request): ClassDetailsResponse => {
    const { id } = Params.parse(request.params);
    const { class: cls } = requireStudent(db, request.teacher as Teacher, id);
    const used =
      db
        .select({ id: schema.attendance.studentId })
        .from(schema.attendance)
        .where(eq(schema.attendance.studentId, id))
        .get() ??
      db
        .select({ id: schema.screenResults.studentId })
        .from(schema.screenResults)
        .where(eq(schema.screenResults.studentId, id))
        .get() ??
      db
        .select({ id: schema.activityEvents.studentId })
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.studentId, id))
        .get();
    if (used) {
      db.update(schema.students).set({ isActive: false }).where(eq(schema.students.id, id)).run();
      request.log.info({ studentId: id }, 'student deactivated (has lesson history)');
    } else {
      db.delete(schema.students).where(eq(schema.students.id, id)).run();
      request.log.info({ studentId: id }, 'student removed');
    }
    renumber(cls.id);
    return details(cls);
  });

  /** Issues a new code; the old card stops working. */
  app.post('/students/:id/code', { preHandler: requireTeacher }, (request): StudentCodeResponse => {
    const { id } = Params.parse(request.params);
    const { student, class: cls } = requireStudent(db, request.teacher as Teacher, id);
    // Codes of the other students, plus this student's current code: "new code" must really change it.
    const taken = new Set(
      db
        .select({ code: schema.students.codePublic })
        .from(schema.students)
        .where(and(eq(schema.students.classId, cls.id), ne(schema.students.id, id)))
        .all()
        .map((r) => r.code),
    );
    taken.add(student.codePublic);
    const code =
      student.codeKind === 'pics'
        ? randomPictureCode(cls.settings.codePics, taken)
        : randomDigitCode(taken);
    db.update(schema.students)
      .set({ codePublic: code, codeHash: hashSecretSync(code) })
      .where(eq(schema.students.id, id))
      .run();
    request.log.info({ studentId: id }, 'student code reissued');
    const updated = db.select().from(schema.students).where(eq(schema.students.id, id)).get();
    return { student: toStudent(updated as StudentRow) };
  });

  done();
};
