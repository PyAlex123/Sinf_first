import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  AssignSchoolAdminSchema,
  CreateSchoolSchema,
  SchoolDecisionSchema,
  SetSchoolRoleSchema,
  UpdateSchoolSchema,
  type AdminSchoolListResponse,
  type SchoolBrief,
  type SchoolClass,
  type SchoolDetailsResponse,
  type SchoolListResponse,
  type SchoolMember,
  type Teacher,
} from '@sinf/shared';
import {
  requireSchoolAdmin,
  requireSchoolMember,
  requireSuperadmin,
  type SchoolRow,
} from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';

const Params = z.object({ id: z.string().min(1) });
const MemberParams = z.object({ id: z.string().min(1), userId: z.string().min(1) });

/**
 * Schools (S2.3, ADR-009). A school is created by us (the superadmin); a teacher finds theirs in the
 * list and asks to join, and the school's administrator decides. Everything a teacher may not see
 * answers 404 — never 403, which would confirm that the school or the page exists.
 */
export const schoolRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db } = app.ctx;

  const brief = (row: SchoolRow): SchoolBrief => ({ id: row.id, name: row.name, city: row.city });

  const membersOf = (schoolId: string, withEmail: boolean): SchoolMember[] =>
    db
      .select({
        userId: schema.users.id,
        fullName: schema.users.fullName,
        email: schema.users.email,
        role: schema.schoolMembers.role,
      })
      .from(schema.schoolMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.schoolMembers.userId))
      .where(eq(schema.schoolMembers.schoolId, schoolId))
      .orderBy(schema.users.fullName)
      .all()
      .map((row) => ({ ...row, email: withEmail ? row.email : null }));

  const classesOfSchool = (schoolId: string): SchoolClass[] => {
    const rows = db
      .select()
      .from(schema.classes)
      .where(eq(schema.classes.schoolId, schoolId))
      .orderBy(schema.classes.grade, schema.classes.name)
      .all();
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const counts = db
      .select({ classId: schema.students.classId, n: count(schema.students.id) })
      .from(schema.students)
      .where(inArray(schema.students.classId, ids))
      .groupBy(schema.students.classId)
      .all();
    const teachers = db
      .select({ classId: schema.classTeachers.classId, name: schema.users.fullName })
      .from(schema.classTeachers)
      .innerJoin(schema.users, eq(schema.users.id, schema.classTeachers.userId))
      .where(inArray(schema.classTeachers.classId, ids))
      .all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      grade: row.grade,
      studentCount: counts.find((c) => c.classId === row.id)?.n ?? 0,
      teachers: teachers.filter((t) => t.classId === row.id).map((t) => t.name),
    }));
  };

  const pendingOf = (schoolId: string) =>
    db
      .select({
        userId: schema.users.id,
        fullName: schema.users.fullName,
        email: schema.users.email,
        createdAt: schema.schoolJoinRequests.createdAt,
      })
      .from(schema.schoolJoinRequests)
      .innerJoin(schema.users, eq(schema.users.id, schema.schoolJoinRequests.userId))
      .where(
        and(
          eq(schema.schoolJoinRequests.schoolId, schoolId),
          eq(schema.schoolJoinRequests.status, 'pending'),
        ),
      )
      .orderBy(schema.schoolJoinRequests.createdAt)
      .all();

  const details = (school: SchoolRow, role: 'admin' | 'teacher'): SchoolDetailsResponse => ({
    school: brief(school),
    role,
    members: membersOf(school.id, role === 'admin'),
    classes: classesOfSchool(school.id),
    requests: role === 'admin' ? pendingOf(school.id) : [],
  });

  // ---------- teacher side

  /** Every school, so a teacher can find their own. Nothing from inside a school is here. */
  app.get('/schools', { preHandler: requireTeacher }, (): SchoolListResponse => {
    const schools = db.select().from(schema.schools).orderBy(schema.schools.name).all();
    return { schools: schools.map(brief) };
  });

  app.get('/schools/:id', { preHandler: requireTeacher }, (request): SchoolDetailsResponse => {
    const { id } = Params.parse(request.params);
    const { school, role } = requireSchoolMember(db, request.teacher as Teacher, id);
    return details(school, role);
  });

  /** Asks to join; the administrator decides. */
  app.post('/schools/:id/requests', { preHandler: requireTeacher }, (request): { ok: true } => {
    const { id } = Params.parse(request.params);
    const teacher = request.teacher as Teacher;
    const school = db.select().from(schema.schools).where(eq(schema.schools.id, id)).get();
    if (!school) throw notFound('School');
    const member = db
      .select()
      .from(schema.schoolMembers)
      .where(
        and(eq(schema.schoolMembers.schoolId, id), eq(schema.schoolMembers.userId, teacher.id)),
      )
      .get();
    if (member) {
      throw new ApiHttpError(409, 'already_member', 'You already belong to this school');
    }
    const existing = db
      .select()
      .from(schema.schoolJoinRequests)
      .where(
        and(
          eq(schema.schoolJoinRequests.schoolId, id),
          eq(schema.schoolJoinRequests.userId, teacher.id),
        ),
      )
      .get();
    if (existing?.status === 'pending') {
      throw new ApiHttpError(409, 'request_pending', 'Your request is waiting for an answer');
    }
    const now = new Date().toISOString();
    if (existing) {
      // A rejected request is reused: the teacher may ask again, e.g. after a word with the school.
      db.update(schema.schoolJoinRequests)
        .set({ status: 'pending', createdAt: now, decidedAt: null, decidedBy: null })
        .where(eq(schema.schoolJoinRequests.id, existing.id))
        .run();
    } else {
      db.insert(schema.schoolJoinRequests)
        .values({
          id: randomUUID(),
          schoolId: id,
          userId: teacher.id,
          status: 'pending',
          createdAt: now,
          decidedAt: null,
          decidedBy: null,
        })
        .run();
    }
    request.log.info({ schoolId: id, userId: teacher.id }, 'school join requested');
    return { ok: true };
  });

  // ---------- administrator of the school

  app.patch('/schools/:id', { preHandler: requireTeacher }, (request): SchoolDetailsResponse => {
    const { id } = Params.parse(request.params);
    const body = UpdateSchoolSchema.parse(request.body);
    const school = requireSchoolAdmin(db, request.teacher as Teacher, id);
    db.update(schema.schools)
      .set({
        name: body.name ?? school.name,
        city: body.city === undefined ? school.city : body.city?.trim() || null,
      })
      .where(eq(schema.schools.id, id))
      .run();
    const updated = db.select().from(schema.schools).where(eq(schema.schools.id, id)).get();
    return details(updated as SchoolRow, 'admin');
  });

  app.post(
    '/schools/:id/requests/:userId',
    { preHandler: requireTeacher },
    (request): SchoolDetailsResponse => {
      const { id, userId } = MemberParams.parse(request.params);
      const { decision } = SchoolDecisionSchema.parse(request.body);
      const teacher = request.teacher as Teacher;
      const school = requireSchoolAdmin(db, teacher, id);
      const pending = db
        .select()
        .from(schema.schoolJoinRequests)
        .where(
          and(
            eq(schema.schoolJoinRequests.schoolId, id),
            eq(schema.schoolJoinRequests.userId, userId),
            eq(schema.schoolJoinRequests.status, 'pending'),
          ),
        )
        .get();
      if (!pending) throw notFound('Request');
      const now = new Date().toISOString();
      db.transaction((tx) => {
        tx.update(schema.schoolJoinRequests)
          .set({
            status: decision === 'approve' ? 'approved' : 'rejected',
            decidedAt: now,
            decidedBy: teacher.id,
          })
          .where(eq(schema.schoolJoinRequests.id, pending.id))
          .run();
        if (decision === 'approve') {
          tx.insert(schema.schoolMembers)
            .values({ schoolId: id, userId, role: 'teacher', createdAt: now })
            .run();
        }
      });
      request.log.info({ schoolId: id, userId, decision }, 'school join decided');
      return details(school, 'admin');
    },
  );

  app.post(
    '/schools/:id/members/:userId/role',
    { preHandler: requireTeacher },
    (request): SchoolDetailsResponse => {
      const { id, userId } = MemberParams.parse(request.params);
      const { role } = SetSchoolRoleSchema.parse(request.body);
      const school = requireSchoolAdmin(db, request.teacher as Teacher, id);
      const member = db
        .select()
        .from(schema.schoolMembers)
        .where(and(eq(schema.schoolMembers.schoolId, id), eq(schema.schoolMembers.userId, userId)))
        .get();
      if (!member) throw notFound('Member');
      if (member.role === 'admin' && role === 'teacher' && adminCount(id) <= 1) {
        throw new ApiHttpError(409, 'last_admin', 'A school keeps at least one administrator');
      }
      db.update(schema.schoolMembers)
        .set({ role })
        .where(and(eq(schema.schoolMembers.schoolId, id), eq(schema.schoolMembers.userId, userId)))
        .run();
      return details(school, 'admin');
    },
  );

  /** Removes a teacher from the school. The classes stay with the school: the person leaves, not the class. */
  app.delete(
    '/schools/:id/members/:userId',
    { preHandler: requireTeacher },
    (request): SchoolDetailsResponse => {
      const { id, userId } = MemberParams.parse(request.params);
      const school = requireSchoolAdmin(db, request.teacher as Teacher, id);
      const member = db
        .select()
        .from(schema.schoolMembers)
        .where(and(eq(schema.schoolMembers.schoolId, id), eq(schema.schoolMembers.userId, userId)))
        .get();
      if (!member) throw notFound('Member');
      if (member.role === 'admin' && adminCount(id) <= 1) {
        throw new ApiHttpError(409, 'last_admin', 'A school keeps at least one administrator');
      }
      db.delete(schema.schoolMembers)
        .where(and(eq(schema.schoolMembers.schoolId, id), eq(schema.schoolMembers.userId, userId)))
        .run();
      request.log.info({ schoolId: id, userId }, 'school member removed');
      return details(school, 'admin');
    },
  );

  function adminCount(schoolId: string): number {
    return (
      db
        .select({ n: count(schema.schoolMembers.userId) })
        .from(schema.schoolMembers)
        .where(
          and(eq(schema.schoolMembers.schoolId, schoolId), eq(schema.schoolMembers.role, 'admin')),
        )
        .get()?.n ?? 0
    );
  }

  // ---------- superadmin

  app.get('/admin/schools', { preHandler: requireTeacher }, (request): AdminSchoolListResponse => {
    requireSuperadmin(db, request.teacher as Teacher);
    const schools = db.select().from(schema.schools).orderBy(schema.schools.name).all();
    return {
      schools: schools.map((school) => {
        const members = membersOf(school.id, false);
        return {
          ...brief(school),
          teachers: members.length,
          classes: classesOfSchool(school.id).length,
          admins: members.filter((m) => m.role === 'admin').map((m) => m.fullName),
        };
      }),
    };
  });

  app.post('/admin/schools', { preHandler: requireTeacher }, (request): { school: SchoolBrief } => {
    requireSuperadmin(db, request.teacher as Teacher);
    const body = CreateSchoolSchema.parse(request.body);
    const row = {
      id: randomUUID(),
      name: body.name,
      city: body.city ?? null,
      settings: {},
      createdAt: new Date().toISOString(),
    };
    db.insert(schema.schools).values(row).run();
    request.log.info({ schoolId: row.id }, 'school created');
    return { school: brief(row) };
  });

  /** Puts a registered teacher in charge of a school; this is how a school gets its first person. */
  app.post('/admin/schools/:id/admins', { preHandler: requireTeacher }, (request): { ok: true } => {
    requireSuperadmin(db, request.teacher as Teacher);
    const { id } = Params.parse(request.params);
    const { email } = AssignSchoolAdminSchema.parse(request.body);
    const school = db.select().from(schema.schools).where(eq(schema.schools.id, id)).get();
    if (!school) throw notFound('School');
    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.trim().toLowerCase()))
      .get();
    if (!user) throw new ApiHttpError(404, 'user_not_found', 'No teacher with this email');
    const now = new Date().toISOString();
    const member = db
      .select()
      .from(schema.schoolMembers)
      .where(and(eq(schema.schoolMembers.schoolId, id), eq(schema.schoolMembers.userId, user.id)))
      .get();
    if (member) {
      db.update(schema.schoolMembers)
        .set({ role: 'admin' })
        .where(and(eq(schema.schoolMembers.schoolId, id), eq(schema.schoolMembers.userId, user.id)))
        .run();
    } else {
      db.insert(schema.schoolMembers)
        .values({ schoolId: id, userId: user.id, role: 'admin', createdAt: now })
        .run();
    }
    request.log.info({ schoolId: id, userId: user.id }, 'school admin assigned');
    return { ok: true };
  });

  done();
};
