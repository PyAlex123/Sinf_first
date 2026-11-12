import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Teacher } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

/** Teacher login state: a signed httpOnly cookie with the user id (stage 1, ADR-004: demo account only). */

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
  if (!user || user.role !== 'teacher') {
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
