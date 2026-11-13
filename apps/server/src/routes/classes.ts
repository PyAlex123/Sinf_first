import { and, eq, ne } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { ClassDetailsResponse, Student, StudentCodeResponse, Teacher } from '@sinf/shared';
import { requireClass, requireStudent } from '../auth/access.js';
import { hashSecretSync } from '../auth/password.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { randomDigitCode, randomPictureCode, splitCode } from '../services/codes.js';

const Params = z.object({ id: z.string().min(1) });

type StudentRow = typeof schema.students.$inferSelect;

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

/** Class details and student codes for the teacher (S1.6). */
export const classRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db } = app.ctx;

  app.get('/classes/:id', { preHandler: requireTeacher }, (request): ClassDetailsResponse => {
    const { id } = Params.parse(request.params);
    const cls = requireClass(db, request.teacher as Teacher, id);
    const students = db
      .select()
      .from(schema.students)
      .where(eq(schema.students.classId, id))
      .orderBy(schema.students.sortOrder)
      .all();
    return {
      class: {
        id: cls.id,
        name: cls.name,
        grade: cls.grade,
        academicYear: cls.academicYear,
        settings: cls.settings,
        studentCount: students.length,
      },
      students: students.map(toStudent),
    };
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
