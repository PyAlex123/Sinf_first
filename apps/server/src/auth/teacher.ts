import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Teacher } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

/** Login state: a signed httpOnly cookie with the user id. Rights are checked in auth/access.ts. */

export const TEACHER_COOKIE = 'sinf_teacher';
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

declare module 'fastify' {
  interface FastifyRequest {
    teacher: Teacher | null;
  }
}

export function setTeacherCookie(reply: FastifyReply, userId: string, secure: boolean): void {
  void reply.setCookie(TEACHER_COOKIE, userId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearTeacherCookie(reply: FastifyReply): void {
  void reply.clearCookie(TEACHER_COOKIE, { path: '/' });
}

/** Reads the cookie and loads the teacher; `null` when absent, tampered or unknown. */
export function readTeacher(request: FastifyRequest, db: Db): Teacher | null {
  const raw = request.cookies[TEACHER_COOKIE];
  if (!raw) {
    return null;
  }
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) {
    return null;
  }
  const user = db.select().from(schema.users).where(eq(schema.users.id, unsigned.value)).get();
  // Any of our roles may hold this cookie: a school administrator and the superadmin are teachers
  // of the site too, and what each of them may do is decided in auth/access.ts (ADR-009).
  if (!user) {
    return null;
  }
  return { id: user.id, email: user.email, fullName: user.fullName, locale: user.locale };
}

/**
 * preHandler: rejects requests without a valid teacher cookie.
 * Callback style on purpose: Fastify waits for `done()` (or a promise) from a hook, so a plain sync function
 * that returns nothing would hang the request.
 */
export const requireTeacher: preHandlerHookHandler = (request, _reply, done) => {
  if (!request.teacher) {
    done(new ApiHttpError(401, 'unauthorized', 'Teacher login required'));
    return;
  }
  done();
};
