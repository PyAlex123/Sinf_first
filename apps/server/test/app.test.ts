import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseListResponseSchema, LessonSchema, MeResponseSchema } from '@sinf/shared';
import { REPO_ROOT } from '../src/config.js';
import { schema, type Db } from '../src/db/index.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  t = await testApp();
});

afterAll(async () => {
  await t.close();
});

/** The part of the demo data a reset must bring back exactly. */
function snapshot(db: Db): unknown {
  return {
    students: db
      .select({
        id: schema.students.id,
        lastName: schema.students.lastName,
        firstName: schema.students.firstName,
        code: schema.students.codePublic,
        sortOrder: schema.students.sortOrder,
      })
      .from(schema.students)
      .orderBy(schema.students.sortOrder)
      .all(),
    classes: db
      .select({
        id: schema.classes.id,
        name: schema.classes.name,
        settings: schema.classes.settings,
      })
      .from(schema.classes)
      .all(),
    teachers: db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .all(),
    sessions: db.select().from(schema.sessions).all().length,
    grades: db.select().from(schema.grades).all().length,
  };
}

describe('GET /health', () => {
  it('answers ok', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('teacher auth', () => {
  it('rejects a wrong password and malformed bodies', async () => {
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      payload: { email: 'demo@sinf.local', password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ error: 'invalid_credentials' });

    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/auth/teacher',
      payload: { email: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'validation' });
  });

  it('logs in with a signed httpOnly cookie and serves /api/me', async () => {
    const cookie = await loginTeacher(t.app);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    const body = MeResponseSchema.parse(me.json());
    expect(body.teacher.email).toBe('demo@sinf.local');
    expect(body.classes).toEqual([
      expect.objectContaining({ name: '1А', grade: 1, studentCount: 20 }) as unknown,
    ]);
  });

  it('ignores a tampered cookie and requires login for /api/me', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/me' });
    expect(anon.statusCode).toBe(401);
    const forged = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: 'sinf_teacher=user-demo-teacher.forgedsignature' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('logs out', async () => {
    const res = await t.app.inject({ method: 'DELETE', url: '/api/auth/teacher' });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 'sinf_teacher')?.value).toBe('');
  });
});

describe('POST /api/demo/reset', () => {
  it('is teacher-only', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/demo/reset' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the demo data to its initial state', async () => {
    const { db } = t.database;
    const initial = snapshot(db);

    db.update(schema.students)
      .set({ firstName: 'Изменён' })
      .where(eq(schema.students.id, 'student-01'))
      .run();
    db.insert(schema.sessions)
      .values({
        id: 'session-x',
        classId: 'class-1a',
        lessonId: 'g10',
        teacherId: 'user-demo-teacher',
        joinCode: '1234',
        status: 'active',
        startedAt: new Date().toISOString(),
      })
      .run();
    db.insert(schema.grades)
      .values({
        id: 'grade-x',
        studentId: 'student-02',
        classId: 'class-1a',
        sessionId: 'session-x',
        date: '2026-11-12',
        stars: 3,
        source: 'session',
        createdAt: new Date().toISOString(),
      })
      .run();
    expect(snapshot(db)).not.toEqual(initial);

    const cookie = await loginTeacher(t.app);
    const res = await t.app.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, students: 20 });
    expect(snapshot(db)).toEqual(initial);

    // the teacher can still log in after a reset (new password hash, same password)
    await expect(loginTeacher(t.app)).resolves.toMatch(/^sinf_teacher=/);
  });
});

describe('content API', () => {
  it('lists courses and serves lessons', async () => {
    const courses = await t.app.inject({ method: 'GET', url: '/api/courses' });
    expect(courses.statusCode).toBe(200);
    const body = CourseListResponseSchema.parse(courses.json());
    expect(body.courses[0]?.lessons).toHaveLength(14);

    const lesson = await t.app.inject({ method: 'GET', url: '/api/lessons/g10' });
    expect(lesson.statusCode).toBe(200);
    expect(LessonSchema.parse(lesson.json()).id).toBe('g10');

    const missing = await t.app.inject({ method: 'GET', url: '/api/lessons/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('static content', () => {
  it('serves JSON with revalidation and media immutable for a year', async () => {
    const course = await t.app.inject({
      method: 'GET',
      url: '/content/1-klass-2-chetvert/course.json',
    });
    expect(course.statusCode).toBe(200);
    expect(course.headers['cache-control']).toBe('no-cache');
    expect(course.headers.etag).toBeDefined();

    const mediaDir = resolve(REPO_ROOT, 'content/1-klass-2-chetvert/media');
    const file = readdirSync(mediaDir)[0];
    const media = await t.app.inject({
      method: 'GET',
      url: `/content/1-klass-2-chetvert/media/${file}`,
    });
    expect(media.statusCode).toBe(200);
    expect(media.headers['content-type']).toBe('image/webp');
    expect(media.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const outside = await t.app.inject({ method: 'GET', url: '/content/../package.json' });
    expect(outside.statusCode).not.toBe(200);
  });
});
