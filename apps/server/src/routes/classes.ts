import { randomUUID } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  AddStudentsSchema,
  CreateClassSchema,
  MAX_STUDENTS_PER_CLASS,
  SeatUpdateSchema,
  UpdateClassSettingsSchema,
  UpdateStudentSchema,
  type AddStudentsResponse,
  type ClassDetailsResponse,
  type ClassSettings,
  type ClassSummary,
  type SeatPlan,
  type Student,
  type StudentCodeResponse,
  type Teacher,
} from '@sinf/shared';
import { requireClass, requireStudent, schoolsOf, type ClassRow } from '../auth/access.js';
import { hashSecretSync } from '../auth/password.js';
import { ensureHomeCodes } from '../services/student-files.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { requireClassSeat, requirePersonalSeat } from '../services/licenses.js';
import { ApiHttpError, notFound } from '../errors.js';
import { moveSeat, seatPlan } from '../services/seats.js';
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

  /** The register: virtual students of the demo (S1.15) are not on it and get no cards. */
  const studentsOf = (classId: string): StudentRow[] =>
    db
      .select()
      .from(schema.students)
      .where(and(eq(schema.students.classId, classId), eq(schema.students.isVirtual, false)))
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
    homeCode: cls.homeCode,
  });

  /**
   * Settings belong to the teachers of the class, not to everyone at its school; and on a school
   * computer they come down from the platform with the roster, so a change there would not last.
   */
  const canEditSettings = (cls: ClassRow, teacher: Teacher): boolean => {
    if (app.sync) return false;
    if (cls.ownerId === teacher.id) return true;
    return Boolean(
      db
        .select({ userId: schema.classTeachers.userId })
        .from(schema.classTeachers)
        .where(
          and(
            eq(schema.classTeachers.classId, cls.id),
            eq(schema.classTeachers.userId, teacher.id),
          ),
        )
        .get(),
    );
  };

  const details = (cls: ClassRow, teacher: Teacher): ClassDetailsResponse => {
    const students = studentsOf(cls.id);
    return {
      class: summaryOf(cls, students.length),
      students: students.map(toStudent),
      canEditSettings: canEditSettings(cls, teacher),
    };
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
    const teacher = request.teacher as Teacher;
    return details(requireClass(db, teacher, id), teacher);
  });

  /**
   * The seating of the class (stage 3, H8): which child sits at which computer of the room. It lives
   * on the teacher's computer only (`CLASSROOM_MODE`, ADR-014); elsewhere there is no room.
   */
  app.get('/classes/:id/seats', { preHandler: requireTeacher }, (request): SeatPlan => {
    if (!app.ctx.config.classroom) throw notFound('Not a classroom computer');
    const { id } = Params.parse(request.params);
    const cls = requireClass(db, request.teacher as Teacher, id);
    return seatPlan(db, cls.id);
  });

  /** The teacher moves a child to a computer, swaps two, or frees a computer (H8). */
  app.put('/classes/:id/seats', { preHandler: requireTeacher }, (request): SeatPlan => {
    if (!app.ctx.config.classroom) throw notFound('Not a classroom computer');
    const { id } = Params.parse(request.params);
    const body = SeatUpdateSchema.parse(request.body);
    const cls = requireClass(db, request.teacher as Teacher, id);
    if (body.studentId !== null) {
      const student = db
        .select()
        .from(schema.students)
        .where(eq(schema.students.id, body.studentId))
        .get();
      // Only a real child of this class sits at a computer: virtual ones play on the server (S1.15).
      if (!student || student.classId !== cls.id || !student.isActive || student.isVirtual) {
        throw new ApiHttpError(400, 'not_in_class', 'Student is not in this class');
      }
    }
    moveSeat(db, cls.id, body.pc, body.studentId);
    request.log.info({ classId: cls.id, pc: body.pc, studentId: body.studentId }, 'seat moved');
    return seatPlan(db, cls.id);
  });

  /** "Turn stars into a 2–5 grade" (S1.13). Grades are worked out on reading, so past lessons follow. */
  app.patch(
    '/classes/:id/settings',
    { preHandler: requireTeacher },
    (request): ClassDetailsResponse => {
      const { id } = Params.parse(request.params);
      const body = UpdateClassSettingsSchema.parse(request.body);
      const teacher = request.teacher as Teacher;
      const cls = requireClass(db, teacher, id);
      if (!canEditSettings(cls, teacher)) {
        throw new ApiHttpError(
          403,
          'settings_locked',
          app.sync
            ? 'Class settings are changed on the platform'
            : 'Only a teacher of this class changes its settings',
        );
      }
      const settings: ClassSettings = { ...cls.settings, starsToGrade: body.starsToGrade };
      db.update(schema.classes).set({ settings }).where(eq(schema.classes.id, cls.id)).run();
      request.log.info(
        { classId: cls.id, starsToGrade: body.starsToGrade },
        'class settings changed',
      );
      return details({ ...cls, settings }, teacher);
    },
  );

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
    // What the school paid for, or the free plan's one personal class (stage 6, B2). A school
    // computer mirrors its classes from the platform and makes none of its own.
    if (schoolId) requireClassSeat(db, schoolId);
    else requirePersonalSeat(db, teacher.id);
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
      homeCode: null as string | null,
      programId: null as string | null,
    };
    db.transaction((tx) => {
      tx.insert(schema.classes).values(row).run();
      tx.insert(schema.classTeachers)
        .values({ classId: row.id, userId: teacher.id, createdAt: row.createdAt })
        .run();
    });
    // The code for "Мои работы" at home; a school computer gets the platform's with the roster.
    if (!app.sync) ensureHomeCodes(db);
    row.homeCode =
      db
        .select({ homeCode: schema.classes.homeCode })
        .from(schema.classes)
        .where(eq(schema.classes.id, row.id))
        .get()?.homeCode ?? null;
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
      return { ...details(cls, request.teacher as Teacher), added: fresh.length, skipped };
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
    return details(cls, request.teacher as Teacher);
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
    return details(cls, request.teacher as Teacher);
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
