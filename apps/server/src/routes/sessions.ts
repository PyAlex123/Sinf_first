import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  CreateSessionSchema,
  type SessionResponse,
  type SessionState,
  type Teacher,
} from '@sinf/shared';
import { requireTeacher } from '../auth/teacher.js';
import { notFound } from '../errors.js';
import type { SessionStore } from '../realtime/session-store.js';

const Params = z.object({ id: z.string().min(1) });

/** Teacher-side session management (STAGE1 S1.7 slice). */
export const sessionRoutes: FastifyPluginCallback<{ store: SessionStore }> = (app, opts, done) => {
  const { store } = opts;

  app.post('/sessions', { preHandler: requireTeacher }, (request): SessionResponse => {
    const body = CreateSessionSchema.parse(request.body);
    const teacher = request.teacher as Teacher;
    const session = store.create({ ...body, teacherId: teacher.id });
    return { session };
  });

  app.get(
    '/sessions/:id',
    { preHandler: requireTeacher },
    (request): SessionResponse & { state: SessionState | null } => {
      const { id } = Params.parse(request.params);
      const session = store.summary(id);
      if (!session) throw notFound('Session not found');
      return { session, state: store.getState(id) ?? null };
    },
  );

  app.post('/sessions/:id/end', { preHandler: requireTeacher }, (request): SessionResponse => {
    const { id } = Params.parse(request.params);
    if (!store.summary(id)) throw notFound('Session not found');
    store.end(id);
    return { session: store.summary(id) as SessionResponse['session'] };
  });

  done();
};
