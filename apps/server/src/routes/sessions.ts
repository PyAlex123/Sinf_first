import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  CreateSessionSchema,
  type SessionResponse,
  type SessionState,
  type Teacher,
} from '@sinf/shared';
import { requireClass, requireSessionClass } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import type { SessionStore } from '../realtime/session-store.js';

const Params = z.object({ id: z.string().min(1) });

/** Teacher-side session management (STAGE1 S1.7 slice). */
export const sessionRoutes: FastifyPluginCallback<{ store: SessionStore }> = (app, opts, done) => {
  const { store } = opts;
  const { db } = app.ctx;

  app.post('/sessions', { preHandler: requireTeacher }, (request): SessionResponse => {
    const body = CreateSessionSchema.parse(request.body);
    const teacher = request.teacher as Teacher;
    // A lesson may only be started for a class this teacher may see (ADR-009).
    requireClass(db, teacher, body.classId);
    const session = store.create({ ...body, teacherId: teacher.id });
    return { session };
  });

  app.get(
    '/sessions/:id',
    { preHandler: requireTeacher },
    (request): SessionResponse & { state: SessionState | null } => {
      const { id } = Params.parse(request.params);
      // Proves both that the session exists and that this teacher may see its class.
      requireSessionClass(db, request.teacher as Teacher, id);
      return {
        session: store.summary(id) as SessionResponse['session'],
        state: store.getState(id) ?? null,
      };
    },
  );

  app.post('/sessions/:id/end', { preHandler: requireTeacher }, (request): SessionResponse => {
    const { id } = Params.parse(request.params);
    requireSessionClass(db, request.teacher as Teacher, id);
    store.end(id);
    return { session: store.summary(id) as SessionResponse['session'] };
  });

  done();
};
