import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { CourseListResponse, Lesson, QuizResponse } from '@sinf/shared';
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
  /**
   * The lesson's live quiz (S1.12). Most lessons have none, and that is not an error: a 404 here
   * would show up as a failed request in every child's console on every other lesson.
   */
  app.get('/lessons/:id/quiz', (request): QuizResponse => {
    const { id } = LessonParams.parse(request.params);
    const lesson = content.getLesson(id);
    if (!lesson) {
      throw notFound(`Lesson "${id}" not found`);
    }
    return { quiz: content.getQuiz(id) ?? null };
  });

  done();
};
