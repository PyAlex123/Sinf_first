import { randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import {
  ForgotPasswordSchema,
  ResetPasswordSchema,
  TeacherLoginSchema,
  TeacherRegisterSchema,
  type MeResponse,
  type Teacher,
} from '@sinf/shared';
import { visibleClassWhere } from '../auth/access.js';
import { readPlatformLink } from '../config.js';
import { verifyOnPlatform } from '../sync/platform-login.js';
import { hashSecret, verifySecret } from '../auth/password.js';
import { clearTeacherCookie, requireTeacher, setTeacherCookie } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError } from '../errors.js';
import { AttemptGuard } from '../services/attempt-guard.js';
import {
  makeResetToken,
  resetLetter,
  resetPassword,
  resetUrl,
  siteUrl,
} from '../services/password-reset.js';

export const authRoutes: FastifyPluginCallback<{
  loginGuard?: AttemptGuard;
  /** Tests point this at their own platform; in production it is the global `fetch`. */
  platformFetch?: typeof fetch;
}> = (app, opts, done) => {
  const { db, config } = app.ctx;
  // Slows a password search down; per process, like the student code guard (ADR-009).
  const guard = opts.loginGuard ?? new AttemptGuard();
  /** At most three letters a quarter of an hour to one address: no mail bombing by our hand. */
  const letters = new AttemptGuard(3, 15 * 60 * 1000);

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
      sessionVersion: 0,
    };
    db.insert(schema.users).values(user).run();
    // A new teacher starts in their own space: no school, no classes yet (S2.2 adds creating them).
    setTeacherCookie(reply, user, config.env === 'production');
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
    let ok = user ? await verifySecret(body.password, user.passwordHash) : false;
    /*
     * School computer (S2.6): the roster came from the platform without password hashes, so the
     * first login of a teacher is checked there and then remembered here. Every later lesson can
     * then start with no internet at all — which is the whole point (CLAUDE.md §3.3).
     */
    if (!ok && user) {
      const link = readPlatformLink(config);
      const onPlatform = link
        ? await verifyOnPlatform(link, email, body.password, opts.platformFetch)
        : null;
      // Only the teacher this computer already knows from its school's roster, and no one else.
      if (onPlatform && onPlatform.id === user.id) {
        db.update(schema.users)
          .set({ passwordHash: await hashSecret(body.password) })
          .where(eq(schema.users.id, user.id))
          .run();
        ok = true;
      }
    }
    if (!user || !ok) {
      const failed = guard.fail(email, now);
      throw new ApiHttpError(401, 'invalid_credentials', 'Wrong email or password', {
        attemptsLeft: failed.attemptsLeft,
        ...(failed.locked ? { retryAfterSec: failed.retryAfterSec } : {}),
      });
    }
    guard.reset(email);
    setTeacherCookie(reply, user, config.env === 'production');
    return { teacher: toTeacher(user) };
  });

  // ---------- a forgotten password (PLAN.md 2.1; stage 5, A7)

  const platformOnly = (): void => {
    if (readPlatformLink(config)) {
      throw new ApiHttpError(409, 'edit_on_platform', 'Passwords are reset on the website');
    }
  };

  /** Always "sent": whether this address is ours is nobody's business. */
  app.post('/auth/forgot', async (request): Promise<{ ok: true }> => {
    platformOnly();
    const { email: raw } = ForgotPasswordSchema.parse(request.body);
    const email = raw.trim().toLowerCase();
    const now = Date.now();
    const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (!user || letters.status(email, now).locked) return { ok: true };
    letters.fail(email, now);
    const { token } = makeResetToken(db, user.id, null);
    const url = resetUrl(siteUrl(config, request), token);
    try {
      await app.mailer.send(resetLetter(user.email, user.fullName, url, user.locale));
      request.log.info({ userId: user.id }, 'password reset letter sent');
    } catch (error) {
      request.log.error({ err: error, userId: user.id }, 'password reset letter failed');
    }
    return { ok: true };
  });

  /** A new password by the link; the teacher is signed in with it, every other login ends. */
  app.post('/auth/reset', async (request, reply): Promise<{ teacher: Teacher }> => {
    platformOnly();
    const body = ResetPasswordSchema.parse(request.body);
    const { userId } = await resetPassword(db, body.token, body.password);
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) throw new ApiHttpError(400, 'reset_gone', 'This link no longer works');
    guard.reset(user.email);
    setTeacherCookie(reply, user, config.env === 'production');
    request.log.info({ userId }, 'password reset');
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
        schoolId: schema.classes.schoolId,
        schoolName: schema.schools.name,
        homeCode: schema.classes.homeCode,
      })
      .from(schema.classes)
      // Virtual students of the demo (S1.15) are not members of the class.
      .leftJoin(
        schema.students,
        and(eq(schema.students.classId, schema.classes.id), eq(schema.students.isVirtual, false)),
      )
      .leftJoin(schema.schools, eq(schema.schools.id, schema.classes.schoolId))
      .where(visibleClassWhere(db, teacher.id))
      .groupBy(schema.classes.id)
      .orderBy(schema.classes.grade, schema.classes.name)
      .all();
    const schools = db
      .select({
        id: schema.schools.id,
        name: schema.schools.name,
        city: schema.schools.city,
        role: schema.schoolMembers.role,
      })
      .from(schema.schoolMembers)
      .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolMembers.schoolId))
      .where(eq(schema.schoolMembers.userId, teacher.id))
      .orderBy(schema.schools.name)
      .all();
    const waiting = db
      .select({
        id: schema.schools.id,
        name: schema.schools.name,
        city: schema.schools.city,
      })
      .from(schema.schoolJoinRequests)
      .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolJoinRequests.schoolId))
      .where(
        and(
          eq(schema.schoolJoinRequests.userId, teacher.id),
          eq(schema.schoolJoinRequests.status, 'pending'),
        ),
      )
      .get();
    const me = db.select().from(schema.users).where(eq(schema.users.id, teacher.id)).get();
    return {
      teacher,
      classes,
      schools,
      pendingSchool: waiting ?? null,
      isSuperadmin: me?.role === 'superadmin',
    };
  });
  done();
};
