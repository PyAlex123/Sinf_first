import type { FastifyPluginCallback } from 'fastify';
import type { DemoResetResponse } from '@sinf/shared';
import { requireTeacher } from '../auth/teacher.js';
import { resetDemo } from '../db/seed.js';

export const demoRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, config } = app.ctx;

  /** Returns the demo data to its initial state. Teacher only. */
  app.post('/demo/reset', { preHandler: requireTeacher }, (request): DemoResetResponse => {
    const result = resetDemo(db, { teacherPassword: config.demoTeacherPassword });
    request.log.info({ students: result.students }, 'demo data reset');
    return { ok: true, students: result.students };
  });
  done();
};
