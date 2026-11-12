import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { CourseListResponse, Lesson } from '@sinf/shared';
import { notFound } from '../errors.js';

const LessonParams = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) });

export const contentRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { content } = app.ctx;

  app.get('/courses', (): CourseListResponse => ({ courses: [...content.courses] }));

  app.get('/lessons/:id', (request): Lesson => {
    const { id } = LessonParams.parse(request.params);
    const lesson = content.getLesson(id);
    if (!lesson) {
      throw notFound(`Lesson "${id}" not found`);
    }
    return lesson;
  });
  done();
};
