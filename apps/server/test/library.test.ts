import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthoredLessonSchema,
  LibraryReportsResponseSchema,
  LibraryResponseSchema,
  type AuthoredLesson,
} from '@sinf/shared';
import { ensureSuperadmin } from '../src/db/seed.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** W8 (PLAN.md 3.9): the library — find, copy, report, hide. */

let t: TestApp;
let author: string;
let other: string;

async function cookieOf(email: string, password: string): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/teacher',
    payload: { email, password },
  });
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  if (!jar) throw new Error(`login failed: ${res.statusCode}`);
  return `${jar.name}=${jar.value}`;
}

beforeEach(async () => {
  t = await testApp();
  author = await loginTeacher(t.app);
  const reg = await t.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: 'reader@example.com',
      password: 'reader-pass-1',
      fullName: 'Другая Учительница',
    },
  });
  const jar = reg.cookies.find((c) => c.name === 'sinf_teacher');
  if (!jar) throw new Error('no cookie');
  other = `${jar.name}=${jar.value}`;
});

afterEach(async () => {
  await t.close();
});

async function publicLesson(title: string, topic: string, grade: number): Promise<AuthoredLesson> {
  const made = AuthoredLessonSchema.parse(
    (
      await t.app.inject({
        method: 'POST',
        url: '/api/authored-lessons',
        headers: { cookie: author },
        payload: { title, grade },
      })
    ).json(),
  );
  const saved = await t.app.inject({
    method: 'PUT',
    url: `/api/authored-lessons/${made.id}`,
    headers: { cookie: author },
    payload: { title, grade, topic, visibility: 'public', doc: made.doc, version: 1 },
  });
  return AuthoredLessonSchema.parse(saved.json());
}

const search = async (query: string, as = other) =>
  LibraryResponseSchema.parse(
    (
      await t.app.inject({ method: 'GET', url: `/api/library?${query}`, headers: { cookie: as } })
    ).json(),
  ).items;

describe('the library', () => {
  it('finds public lessons by grade and words, Cyrillic and ё included', async () => {
    const tree = await publicLesson('Ёлка из фигур', 'Рисуем в Paint', 2);
    await publicLesson('Таблицы в Excel', 'Формулы', 7);
    // A private lesson is nobody else's business.
    await t.app.inject({
      method: 'POST',
      url: '/api/authored-lessons',
      headers: { cookie: author },
      payload: { title: 'Черновик ёлки', grade: 2 },
    });

    expect((await search('kind=lesson')).map((i) => i.title).sort()).toEqual([
      'Ёлка из фигур',
      'Таблицы в Excel',
    ]);
    expect((await search('kind=lesson&grade=2')).map((i) => i.id)).toEqual([tree.id]);
    expect(
      (await search(`kind=lesson&q=${encodeURIComponent('ЕЛКА paint')}`)).map((i) => i.id),
    ).toEqual([tree.id]);
    expect((await search('kind=lesson&q=photoshop')).length).toBe(0);
    expect((await search('kind=lesson&grade=2', author))[0]?.mine).toBe(true);
  });

  it('counts copies, and the most copied comes first', async () => {
    const a = await publicLesson('Урок А', '', 5);
    const b = await publicLesson('Урок Б', '', 5);
    await t.app.inject({
      method: 'POST',
      url: `/api/authored-lessons/${b.id}/copy`,
      headers: { cookie: other },
    });
    const items = await search('kind=lesson&grade=5');
    expect(items.map((i) => [i.id, i.copies])).toEqual([
      [b.id, 1],
      [a.id, 0],
    ]);
  });

  it('takes a report, and the superadmin hides the item from the library', async () => {
    const lesson = await publicLesson('Плохой урок', '', 6);
    const reported = await t.app.inject({
      method: 'POST',
      url: '/api/library/report',
      headers: { cookie: other },
      payload: { kind: 'lesson', id: lesson.id, reason: 'Не по теме урока' },
    });
    expect(reported.statusCode).toBe(200);

    // A teacher cannot read the reports; the superadmin can.
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/admin/library/reports',
          headers: { cookie: other },
        })
      ).statusCode,
    ).toBe(404);
    ensureSuperadmin(t.database.db, { email: 'root@sinf.local', password: 'superparol123' });
    const root = await cookieOf('root@sinf.local', 'superparol123');
    const reports = LibraryReportsResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/admin/library/reports',
          headers: { cookie: root },
        })
      ).json(),
    ).reports;
    expect(reports).toMatchObject([
      { itemId: lesson.id, reason: 'Не по теме урока', reporterName: 'Другая Учительница' },
    ]);

    const hide = await t.app.inject({
      method: 'POST',
      url: `/api/admin/library/lesson/${lesson.id}/moderate`,
      headers: { cookie: root },
      payload: { hidden: true },
    });
    expect(hide.statusCode).toBe(200);
    expect(await search('kind=lesson&grade=6')).toEqual([]);
    // Others cannot open it any more; its author still has it.
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/authored-lessons/${lesson.id}`,
          headers: { cookie: other },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/authored-lessons/${lesson.id}`,
          headers: { cookie: author },
        })
      ).statusCode,
    ).toBe(200);
    // The report is dealt with.
    expect(
      LibraryReportsResponseSchema.parse(
        (
          await t.app.inject({
            method: 'GET',
            url: '/api/admin/library/reports',
            headers: { cookie: root },
          })
        ).json(),
      ).reports,
    ).toEqual([]);
  });
});
