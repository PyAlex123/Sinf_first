import type { FastifyPluginCallback } from 'fastify';
import {
  AddVirtualSchema,
  DEMO_CLASS_ID,
  DEMO_TEACHER_ID,
  MAX_VIRTUAL_STUDENTS,
  type DemoResetResponse,
  type DemoStatus,
  type Teacher,
} from '@sinf/shared';
import { requireTeacher } from '../auth/teacher.js';
import { ensureVirtualStudents, resetDemoClass } from '../db/seed.js';
import { ApiHttpError, notFound } from '../errors.js';
import type { SessionStore } from '../realtime/session-store.js';
import type { VirtualStudents } from '../services/virtual-students.js';

/**
 * The demo page (S1.15, ADR-013): virtual students for the demo lesson and the demo reset. Only the
 * demo teacher and only the demo class — anyone else gets 404, as for anything that is not theirs
 * (ADR-009). On the platform real teachers and schools live beside the demo, so the reset touches
 * class 1А alone.
 */
export const demoRoutes: FastifyPluginCallback<{
  store: SessionStore;
  virtual: VirtualStudents;
}> = (app, opts, done) => {
  const { db } = app.ctx;
  const { store, virtual } = opts;

  const requireDemoTeacher = (teacher: Teacher | null): void => {
    if (teacher?.id !== DEMO_TEACHER_ID) throw notFound('Page not found');
  };

  const status = (): DemoStatus => {
    const session = store.activeSessionOfClass(DEMO_CLASS_ID) ?? null;
    const state = session ? store.getState(session.id) : undefined;
    const inState = state ? Object.values(state.participants).filter((p) => p.virtual).length : 0;
    return {
      classId: DEMO_CLASS_ID,
      session,
      virtualInSession: session ? Math.max(inState, virtual.count(session.id)) : 0,
      virtualMax: MAX_VIRTUAL_STUDENTS,
    };
  };

  app.get('/demo', { preHandler: requireTeacher }, (request): DemoStatus => {
    requireDemoTeacher(request.teacher);
    return status();
  });

  /** Adds virtual students to the running demo lesson; they come in over the next 20 seconds. */
  app.post('/demo/virtual', { preHandler: requireTeacher }, (request): DemoStatus => {
    requireDemoTeacher(request.teacher);
    const body = AddVirtualSchema.parse(request.body);
    const summary = store.summary(body.sessionId);
    if (!summary || summary.classId !== DEMO_CLASS_ID || summary.status !== 'active') {
      throw notFound('Demo lesson not found');
    }
    const current = status().virtualInSession;
    const room = MAX_VIRTUAL_STUDENTS - current;
    if (body.count > room) {
      throw new ApiHttpError(400, 'too_many', 'Too many virtual students for one lesson', {
        room,
      });
    }
    const playing = virtual.playing(summary.id);
    const state = store.getState(summary.id);
    const inLesson = new Set(Object.keys(state?.participants ?? {}));
    // Reuse the pool from the start; skip those already in this lesson.
    const pool = ensureVirtualStudents(db, MAX_VIRTUAL_STUDENTS).filter(
      (s) => !playing.has(s.id) && !inLesson.has(s.id),
    );
    const added = virtual.add(summary.id, pool.slice(0, body.count));
    request.log.info({ sessionId: summary.id, added }, 'virtual students requested');
    return status();
  });

  /** The demo back to its start: lessons, results and virtual students of 1А go away. */
  app.post('/demo/reset', { preHandler: requireTeacher }, (request): DemoResetResponse => {
    requireDemoTeacher(request.teacher);
    const active = store.activeSessionOfClass(DEMO_CLASS_ID);
    if (active) {
      virtual.stop(active.id);
      store.end(active.id);
    }
    const result = resetDemoClass(db);
    request.log.info({ students: result.students }, 'demo class reset');
    return { ok: true, students: result.students };
  });

  done();
};
