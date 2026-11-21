import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AssetUploadResponseSchema,
  AuthoredLessonListResponseSchema,
  AuthoredLessonSchema,
  CourseSchema,
  LessonSchema,
  SessionResponseSchema,
  type AuthoredLesson,
} from '@sinf/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JoinResponseSchema, QuizResponseSchema, StudentFilesResponseSchema } from '@sinf/shared';
import { REPO_ROOT } from '../src/config.js';
import { schema } from '../src/db/index.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** W1 (STAGE4.md): a teacher's own lesson in the database, played as an author's (ADR-019). */

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  for (const id of t.app.sessions.liveSessionIds()) t.app.sessions.end(id);
  await t.close();
});

async function otherTeacher(): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'other@sinf.local', password: 'other-pass-123', fullName: 'Другой Учитель' },
  });
  expect(res.statusCode).toBe(200);
  const c = res.cookies.find((x) => x.name === 'sinf_teacher');
  if (!c) throw new Error('no cookie');
  return `${c.name}=${c.value}`;
}

async function create(title = 'Мой урок', as = cookie): Promise<AuthoredLesson> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/authored-lessons',
    headers: { cookie: as },
    payload: { title, grade: 5 },
  });
  expect(res.statusCode).toBe(200);
  return AuthoredLessonSchema.parse(res.json());
}

function save(lesson: AuthoredLesson, change: Partial<AuthoredLesson>, as = cookie) {
  const next = { ...lesson, ...change };
  return t.app.inject({
    method: 'PUT',
    url: `/api/authored-lessons/${lesson.id}`,
    headers: { cookie: as },
    payload: {
      title: next.title,
      grade: next.grade,
      topic: next.topic,
      visibility: next.visibility,
      doc: next.doc,
      version: next.version,
    },
  });
}

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c636060606000000005000157a0c0b30000000049454e44ae426082',
  'hex',
);

describe('a teacher’s own lesson', () => {
  it('comes from the 45-minute template and plays as an author’s lesson', async () => {
    const lesson = await create('Клавиатура <и> мышь');
    expect(lesson.id).toMatch(/^u-[0-9a-f]{32}$/);
    expect(lesson.doc.stages.map((s) => [s.key, s.minutes])).toEqual([
      ['theory', 10],
      ['practice', 25],
      ['reflection', 7],
      ['summary', 3],
    ]);
    expect(lesson).toMatchObject({ minutes: 45, screens: 4, editable: true, version: 1 });

    // Anybody with the id loads it, as a child in the lesson does: no login.
    const played = LessonSchema.parse(
      (await t.app.inject({ method: 'GET', url: `/api/lessons/${lesson.id}` })).json(),
    );
    expect(played.stages.map((s) => [s.key, s.startMin, s.endMin])).toEqual([
      ['theory', 0, 10],
      ['practice', 10, 35],
      ['reflection', 35, 42],
      ['summary', 42, 45],
    ]);
    expect(played.group).toBe('own');
    expect(played.teacherScenario).toBeNull();
    // What a teacher types is never markup.
    expect(played.screens[0]?.kind === 'slide' && played.screens[0].html).toContain(
      'Клавиатура &lt;и&gt; мышь',
    );

    const course = CourseSchema.parse(
      (await t.app.inject({ method: 'GET', url: `/api/lessons/${lesson.id}/course` })).json(),
    );
    expect(course).toMatchObject({ id: 'own', lessons: [{ id: lesson.id, screens: 4 }] });

    // A class has the lesson the same way as an author's.
    const started = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: 'class-1a', lessonId: lesson.id },
    });
    expect(SessionResponseSchema.parse(started.json()).session.lessonTitle).toBe(
      'Клавиатура <и> мышь',
    );
  });

  it('is saved over the version it came from, and a stale save is refused', async () => {
    const lesson = await create();
    const doc = structuredClone(lesson.doc);
    const theory = doc.stages[0];
    if (!theory) throw new Error('no stage');
    theory.blocks.push({
      id: 'two',
      kind: 'slide',
      title: 'Что такое мышь',
      text: 'Первый абзац.\n\nВторой абзац.',
      bullets: ['левая кнопка', 'правая кнопка'],
      image: null,
    });
    const res = await save(lesson, { doc, topic: 'Устройства' });
    expect(res.statusCode).toBe(200);
    const saved = AuthoredLessonSchema.parse(res.json());
    expect(saved).toMatchObject({ version: 2, topic: 'Устройства', screens: 5 });

    const played = LessonSchema.parse(
      (await t.app.inject({ method: 'GET', url: `/api/lessons/${lesson.id}` })).json(),
    );
    const slide = played.screens[1];
    expect(slide?.kind === 'slide' && slide.html).toContain('<li>левая кнопка</li>');
    expect(slide?.kind === 'slide' && slide.html).toContain('<p>Второй абзац.</p>');

    // The other tab still holds version 1.
    const stale = await save(lesson, { title: 'Из другой вкладки' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'version_conflict', details: { version: 2 } });
  });

  it('refuses a document the engine could not play', async () => {
    const lesson = await create();
    const reversed = { ...lesson.doc, stages: [...lesson.doc.stages].reverse() };
    expect((await save(lesson, { doc: reversed })).statusCode).toBe(400);
    const long = structuredClone(lesson.doc);
    if (long.stages[0]) long.stages[0].minutes = 80;
    expect((await save(lesson, { doc: long })).statusCode).toBe(400);
  });

  it('is seen by its owner, by the school when shared, and changed by its owner only', async () => {
    const lesson = await create();
    const other = await otherTeacher();
    const peek = () =>
      t.app.inject({
        method: 'GET',
        url: `/api/authored-lessons/${lesson.id}`,
        headers: { cookie: other },
      });
    expect((await peek()).statusCode).toBe(404);

    // "public": every teacher sees it, copies it, and cannot change the original.
    const shared = AuthoredLessonSchema.parse(
      (await save(lesson, { visibility: 'public' })).json(),
    );
    expect((await peek()).statusCode).toBe(200);
    expect(AuthoredLessonSchema.parse((await peek()).json()).editable).toBe(false);
    expect((await save(shared, { title: 'Чужое' }, other)).statusCode).toBe(403);
    const copied = await t.app.inject({
      method: 'POST',
      url: `/api/authored-lessons/${lesson.id}/copy`,
      headers: { cookie: other },
    });
    const copy = AuthoredLessonSchema.parse(copied.json());
    expect(copy).toMatchObject({ visibility: 'private', editable: true, title: 'Мой урок' });
    const mine = AuthoredLessonListResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/authored-lessons',
          headers: { cookie: other },
        })
      ).json(),
    );
    expect(mine.lessons.map((l) => l.id)).toEqual([copy.id]);
  });

  it('deleted, leaves the list but still plays for the results of lessons held with it', async () => {
    const lesson = await create();
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/authored-lessons/${lesson.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    const list = AuthoredLessonListResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/authored-lessons', headers: { cookie } })
      ).json(),
    );
    expect(list.lessons).toEqual([]);
    expect(
      (await t.app.inject({ method: 'GET', url: `/api/lessons/${lesson.id}` })).statusCode,
    ).toBe(200);
  });
});

describe('files of a lesson', () => {
  it('keeps a picture by its content, shows it, and the lesson lists it', async () => {
    const up = await t.app.inject({
      method: 'POST',
      url: '/api/assets?ext=png',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(up.statusCode).toBe(200);
    const asset = AssetUploadResponseSchema.parse(up.json());
    const got = await t.app.inject({ method: 'GET', url: asset.url });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');

    const lesson = await create();
    const doc = structuredClone(lesson.doc);
    const first = doc.stages[0]?.blocks[0];
    if (first?.kind !== 'slide') throw new Error('no slide');
    first.image = { sha: asset.sha, ext: 'png', width: 1, height: 1 };
    await save(lesson, { doc });
    const played = LessonSchema.parse(
      (await t.app.inject({ method: 'GET', url: `/api/lessons/${lesson.id}` })).json(),
    );
    expect(played.media).toEqual([asset.url]);
  });

  it('refuses a file that is not what it says, and a stranger', async () => {
    const fake = await t.app.inject({
      method: 'POST',
      url: '/api/assets?ext=webp',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('<script>alert(1)</script>'),
    });
    expect(fake.statusCode).toBe(400);
    const anonymous = await t.app.inject({
      method: 'POST',
      url: '/api/assets?ext=png',
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(anonymous.statusCode).toBe(401);
    const missing = await t.app.inject({
      method: 'GET',
      url: `/content/_assets/${'0'.repeat(64)}.png`,
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('the quiz and the practice of a teacher’s lesson (W5)', () => {
  it('asks only the finished quiz questions, and runs the practice as the sample does', async () => {
    const template = readFileSync(
      join(REPO_ROOT, 'content/proba-praktiki/templates/oformi-dokument.docx'),
    );
    const done = readFileSync(
      join(REPO_ROOT, 'apps/server/test/fixtures/practice/oformi-dokument-done.docx'),
    );
    const up = await t.app.inject({
      method: 'POST',
      url: '/api/assets?ext=docx',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: template,
    });
    const asset = AssetUploadResponseSchema.parse(up.json());
    const lesson = await create('Оформление');
    const doc = structuredClone(lesson.doc);
    doc.quiz = {
      questions: [
        {
          text: 'Где стили?',
          options: ['Главная', '', 'Вставка', 'Вид'],
          correct: 2,
          limitSec: 15,
        },
        { text: '', options: ['а', 'б', '', ''], correct: 0, limitSec: 20 },
      ],
    };
    doc.practice = {
      app: 'word',
      fileName: 'Мой документ.docx',
      template: `${asset.sha}.docx`,
      criteria: [
        {
          id: 'h1',
          kind: 'auto',
          label: { ru: 'Заголовок', uz: 'Sarlavha' },
          points: 2,
          check: { type: 'docx.headings', level: 1, min: 1 },
        },
        { id: 'neat', kind: 'manual', label: { ru: 'Аккуратно', uz: 'Ozoda' }, points: 1 },
      ],
      showChecklist: true,
    };
    expect((await save(lesson, { doc })).statusCode).toBe(200);

    const quiz = QuizResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: `/api/lessons/${lesson.id}/quiz` })).json(),
    ).quiz;
    // The empty option is dropped and the right answer follows it; the unfinished question is not asked.
    expect(quiz?.questions).toEqual([
      {
        text: 'Где стили?',
        say: 'Где стили?',
        options: [{ text: 'Главная' }, { text: 'Вставка' }, { text: 'Вид' }],
        correct: 1,
        limitSec: 15,
      },
    ]);

    const session = SessionResponseSchema.parse(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: { cookie },
          payload: { classId: 'class-1a', lessonId: lesson.id },
        })
      ).json(),
    ).session;
    const student = t.database.db
      .select()
      .from(schema.students)
      .all()
      .find((x) => x.id === 'student-01');
    if (!student) throw new Error('no student');
    const joined = JoinResponseSchema.parse(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/join',
          payload: {
            sessionId: session.id,
            studentId: student.id,
            code: student.codePublic.split('+'),
          },
        })
      ).json(),
    );
    const headers = { 'x-session-id': session.id, 'x-participant-token': joined.token };
    const files = StudentFilesResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/my/files', headers })).json(),
    ).files;
    expect(files.map((f) => [f.name, f.size])).toEqual([['Мой документ.docx', template.length]]);

    await t.app.inject({
      method: 'PUT',
      url: `/api/my/files?name=${encodeURIComponent('Мой документ.docx')}&base=${files[0]?.sha256 ?? ''}`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: done,
    });
    expect(t.app.sessions.getState(session.id)?.participants['student-01']?.check).toMatchObject({
      passed: 1,
      total: 1,
    });
  });
});
