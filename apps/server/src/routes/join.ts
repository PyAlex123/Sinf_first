import { and, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  JoinLookupRequestSchema,
  JoinRequestSchema,
  type JoinClassesResponse,
  type JoinLookupResponse,
  type JoinResponse,
  type JoinSessionResponse,
} from '@sinf/shared';
import { verifySecret } from '../auth/password.js';
import { CODE_SEPARATOR } from '../db/seed.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import type { SessionStore } from '../realtime/session-store.js';
import { JoinGuard } from '../services/join-guard.js';

const Params = z.object({ id: z.string().min(1) });

/** Student login (S1.7): lesson code → class list → personal code → participant token. Public endpoints. */
export const joinRoutes: FastifyPluginCallback<{ store: SessionStore; guard?: JoinGuard }> = (
  app,
  opts,
  done,
) => {
  const { store } = opts;
  const guard = opts.guard ?? new JoinGuard();
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
    return {
      id: session.id,
      lessonId: session.lessonId,
      status: session.status,
      joinCode: session.joinCode,
    };
  });

  /** Lesson code from the projector → the class and its students (names only). */
  app.post('/join/lookup', (request): JoinLookupResponse => {
    const { code } = JoinLookupRequestSchema.parse(request.body);
    const row = db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.joinCode, code), eq(schema.sessions.status, 'active')))
      .get();
    const session = row ? store.summary(row.id) : undefined;
    if (!row || !session) throw notFound('No lesson with this code');
    const cls = db.select().from(schema.classes).where(eq(schema.classes.id, row.classId)).get();
    if (!cls) throw notFound('Class not found');
    const students = db
      .select()
      .from(schema.students)
      .where(and(eq(schema.students.classId, cls.id), eq(schema.students.isActive, true)))
      .orderBy(schema.students.sortOrder)
      .all();
    return {
      session: { id: session.id, lessonId: session.lessonId, lessonTitle: session.lessonTitle },
      class: { id: cls.id, name: cls.name, grade: cls.grade },
      codeKind: students[0]?.codeKind ?? (cls.grade <= 2 ? 'pics' : 'digits'),
      codePics: cls.settings.codePics,
      students: students.map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        sortOrder: s.sortOrder,
      })),
    };
  });

  /** Personal code check; issues the participant token. Five wrong codes lock the student for two minutes. */
  app.post('/join', async (request): Promise<JoinResponse> => {
    const body = JoinRequestSchema.parse(request.body);
    const summary = store.summary(body.sessionId);
    if (!summary || summary.status !== 'active') throw notFound('Session not found or ended');
    const student = db
      .select()
      .from(schema.students)
      .where(eq(schema.students.id, body.studentId))
      .get();
    if (!student || student.classId !== summary.classId || !student.isActive) {
      throw notFound('Student not found in this class');
    }
    const key = `${summary.id}:${student.id}`;
    const now = Date.now();
    const status = guard.status(key, now);
    if (status.locked) {
      throw new ApiHttpError(429, 'locked', 'Too many wrong codes, try later', {
        retryAfterSec: status.retryAfterSec,
      });
    }
    const code = student.codeKind === 'pics' ? body.code.join(CODE_SEPARATOR) : body.code.join('');
    const ok = await verifySecret(code, student.codeHash);
    if (!ok) {
      const after = guard.fail(key, now);
      throw new ApiHttpError(
        401,
        after.locked ? 'locked' : 'wrong_code',
        after.locked ? 'Too many wrong codes, try later' : 'Wrong code',
        after.locked
          ? { retryAfterSec: after.retryAfterSec }
          : { attemptsLeft: after.attemptsLeft },
      );
    }
    guard.reset(key);
    const login = store.loginStudent(summary.id, {
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      sortOrder: student.sortOrder,
    });
    request.log.info({ sessionId: summary.id, studentId: student.id }, 'student joined');
    return {
      token: login.token,
      participantId: login.participantId,
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        sortOrder: student.sortOrder,
      },
      session: { id: summary.id, lessonId: summary.lessonId },
    };
  });

  done();
};
