import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Config } from '../config.js';
import { ApiHttpError } from '../errors.js';

/**
 * The teacher's own computer (test review, 2026-11-25). On a classroom server the teacher's panel
 * is opened by Sinf on http://127.0.0.1, while pupils' devices reach the same server over the
 * network; the demo account's password was even shown in the window. So the teacher's login and
 * everything behind it are accepted only from this computer. The socket address is used, never a
 * forwarded header: a pupil cannot claim to be local.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLocalRequest(request: FastifyRequest): boolean {
  return LOOPBACK.has(request.socket.remoteAddress ?? '');
}

/** Whether a teacher may act from where this request came: anywhere on the site, here in a classroom. */
export function teacherAllowedFrom(config: Config, request: FastifyRequest): boolean {
  return !config.classroom || isLocalRequest(request);
}

/** preHandler for logging in and the like: refuses another device on a classroom server. */
export function localTeacherOnly(config: Config): preHandlerHookHandler {
  return (request, _reply, done) => {
    if (!teacherAllowedFrom(config, request)) {
      done(
        new ApiHttpError(
          403,
          'teacher_local_only',
          'The teacher signs in only on the teacher computer',
        ),
      );
      return;
    }
    done();
  };
}
