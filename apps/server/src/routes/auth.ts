import { count, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { TeacherLoginSchema, type MeResponse, type Teacher } from '@sinf/shared';
import { verifySecret } from '../auth/password.js';
import { clearTeacherCookie, requireTeacher, setTeacherCookie } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

export const authRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, config } = app.ctx;

  app.post('/auth/teacher', async (request, reply): Promise<{ teacher: Teacher }> => {
    const body = TeacherLoginSchema.parse(request.body);
    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, body.email.toLowerCase()))
      .get();
    const ok = user ? await verifySecret(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new ApiHttpError(401, 'invalid_credentials', 'Wrong email or password');
    }
    setTeacherCookie(reply, user.id, config.env === 'production');
    return {
      teacher: { id: user.id, email: user.email, fullName: user.fullName, locale: user.locale },
    };
  });

  app.delete('/auth/teacher', (_request, reply): { ok: true } => {
    clearTeacherCookie(reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireTeacher }, (request): MeResponse => {
    const teacher = request.teacher as Teacher;
    const classes = db
      .select({
        id: schema.classes.id,
        name: schema.classes.name,
        grade: schema.classes.grade,
        academicYear: schema.classes.academicYear,
        settings: schema.classes.settings,
        studentCount: count(schema.students.id),
      })
      .from(schema.classes)
      .leftJoin(schema.students, eq(schema.students.classId, schema.classes.id))
      .groupBy(schema.classes.id)
      .orderBy(schema.classes.name)
      .all();
    return { teacher, classes };
  });
  done();
};
