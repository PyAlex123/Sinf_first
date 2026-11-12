import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { JoinClassesResponse, JoinSessionResponse } from '@sinf/shared';
import { schema } from '../db/index.js';
import { notFound } from '../errors.js';
import type { SessionStore } from '../realtime/session-store.js';

const Params = z.object({ id: z.string().min(1) });

/** Public endpoints for students joining a lesson (no student login yet — ADR-007). */
export const joinRoutes: FastifyPluginCallback<{ store: SessionStore }> = (app, opts, done) => {
  const { store } = opts;
  const { db } = app.ctx;

  app.get('/join/classes', (): JoinClassesResponse => {
    const classes = db
      .select({ id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade })
      .from(schema.classes)
      .orderBy(schema.classes.grade, schema.classes.name)
      .all();
    return {
      classes: classes.map((c) => {
        const active = store.activeSessionOfClass(c.id);
        return {
          ...c,
          activeSession: active
            ? { id: active.id, lessonId: active.lessonId, lessonTitle: active.lessonTitle }
            : null,
        };
      }),
    };
  });

  app.get('/join/session/:id', (request): JoinSessionResponse => {
    const { id } = Params.parse(request.params);
    const session = store.summary(id);
    if (!session) throw notFound('Session not found');
    return { id: session.id, lessonId: session.lessonId, status: session.status };
  });

  done();
};
