import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import {
  TeacherLoginSchema,
  TeacherRegisterSchema,
  type MeResponse,
  type Teacher,
} from '@sinf/shared';
import { visibleClassWhere } from '../auth/access.js';
import { hashSecret, verifySecret } from '../auth/password.js';
import { clearTeacherCookie, requireTeacher, setTeacherCookie } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError } from '../errors.js';
import { AttemptGuard } from '../services/attempt-guard.js';

export const authRoutes: FastifyPluginCallback<{ loginGuard?: AttemptGuard }> = (
  app,
  opts,
  done,
) => {
  const { db, config } = app.ctx;
  // Slows a password search down; per process, like the student code guard (ADR-009).
  const guard = opts.loginGuard ?? new AttemptGuard();

  const toTeacher = (user: typeof schema.users.$inferSelect): Teacher => ({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    locale: user.locale,
  });

  app.post('/auth/register', async (request, reply): Promise<{ teacher: Teacher }> => {
    const body = TeacherRegisterSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();
    const taken = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (taken) {
      throw new ApiHttpError(409, 'email_taken', 'This email is already registered');
    }
    const user = {
      id: randomUUID(),
      role: 'teacher' as const,
      email,
      passwordHash: await hashSecret(body.password),
      fullName: body.fullName.trim(),
      locale: body.locale ?? ('ru' as const),
      createdAt: new Date().toISOString(),
    };
    db.insert(schema.users).values(user).run();
    // A new teacher starts in their own space: no school, no classes yet (S2.2 adds creating them).
    setTeacherCookie(reply, user.id, config.env === 'production');
    return { teacher: toTeacher(user) };
  });

  app.post('/auth/teacher', async (request, reply): Promise<{ teacher: Teacher }> => {
    const body = TeacherLoginSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();
    const now = Date.now();
    const status = guard.status(email, now);
    if (status.locked) {
      throw new ApiHttpError(429, 'too_many_attempts', 'Too many attempts, try again later', {
        retryAfterSec: status.retryAfterSec,
      });
    }
    const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    const ok = user ? await verifySecret(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      const failed = guard.fail(email, now);
      throw new ApiHttpError(401, 'invalid_credentials', 'Wrong email or password', {
        attemptsLeft: failed.attemptsLeft,
        ...(failed.locked ? { retryAfterSec: failed.retryAfterSec } : {}),
      });
    }
    guard.reset(email);
    setTeacherCookie(reply, user.id, config.env === 'production');
    return { teacher: toTeacher(user) };
  });

  app.delete('/auth/teacher', (_request, reply): { ok: true } => {
    clearTeacherCookie(reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireTeacher }, (request): MeResponse => {
    const teacher = request.teacher as Teacher;
    // Only the classes this teacher may see: their own, the ones they teach, their schools' (ADR-009).
    const classes = db
      .select({
        id: schema.classes.id,
        name: schema.classes.name,
        grade: schema.classes.grade,
        academicYear: schema.classes.academicYear,
        settings: schema.classes.settings,
        studentCount: count(schema.students.id),
      })
      .from(schema.classes)
      .leftJoin(schema.students, eq(schema.students.classId, schema.classes.id))
      .where(visibleClassWhere(db, teacher.id))
      .groupBy(schema.classes.id)
      .orderBy(schema.classes.name)
      .all();
    return { teacher, classes };
  });
  done();
};
