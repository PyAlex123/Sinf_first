import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AddStudentsResponseSchema,
  ClassDetailsResponseSchema,
  ClassSummarySchema,
  MAX_STUDENTS_PER_CLASS,
  MeResponseSchema,
  parseRoster,
  SessionResponseSchema,
  type ClassSummary,
} from '@sinf/shared';
import { currentAcademicYear } from '../src/routes/classes.js';
import { DEMO } from '../src/db/seed.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** S2.2: a teacher creates a class, pastes a roster, fixes a name and removes a student. */

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

/** 30 fictional names in the shape Excel gives: a row number, then two columns. */
const CLASS_OF_30 = Array.from({ length: 30 }, (_, i) => {
  const letters = [...'абвгдежзийклмнопрстуфхцчшщэюя'];
  const suffix = `${letters[Math.floor(i / letters.length)] ?? ''}${letters[i % letters.length] ?? ''}`;
  return `${i + 1}.\tФамилия${suffix}\tИмя${suffix}`;
}).join('\n');

const CreatedSchema = z.strictObject({ class: ClassSummarySchema });

async function createClass(
  payload: Record<string, unknown> = { name: '5Б', grade: 5 },
  who = cookie,
) {
  return t.app.inject({ method: 'POST', url: '/api/classes', headers: { cookie: who }, payload });
}

/** Creates a class and returns it, failing loudly when the request did not succeed. */
async function newClass(
  payload: Record<string, unknown> = { name: '5Б', grade: 5 },
): Promise<ClassSummary> {
  const res = await createClass(payload);
  expect(res.statusCode).toBe(200);
  return CreatedSchema.parse(res.json()).class;
}

async function addStudents(classId: string, text: string, who = cookie) {
  const { students } = parseRoster(text);
  return t.app.inject({
    method: 'POST',
    url: `/api/classes/${classId}/students`,
    headers: { cookie: who },
    payload: { students },
  });
}

async function registerOutsider(): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { fullName: 'Чужой Учитель', email: 'outsider@example.com', password: 'parol12345' },
  });
  const jar = res.cookies.find((c) => c.name === 'sinf_teacher');
  if (!jar) throw new Error('no cookie');
  return `${jar.name}=${jar.value}`;
}

describe('creating a class', () => {
  it('puts it in the school the teacher belongs to and fills the academic year', async () => {
    const created = await newClass();
    expect(created.schoolId).toBe(DEMO.schoolId);
    expect(created.academicYear).toBe(currentAcademicYear());

    const me = MeResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json(),
    );
    expect(me.classes.map((c) => c.name)).toContain('5Б');
  });

  it('makes a personal class for a teacher who is in no school', async () => {
    const outsider = await registerOutsider();
    const res = await createClass({ name: '7А', grade: 7 }, outsider);
    expect(res.statusCode).toBe(200);
    expect(CreatedSchema.parse(res.json()).class.schoolId).toBeNull();
  });

  it('refuses a school the teacher does not belong to', async () => {
    const outsider = await registerOutsider();
    const res = await createClass({ name: '7А', grade: 7, schoolId: DEMO.schoolId }, outsider);
    expect(res.statusCode).toBe(404);
  });

  it('checks the name and the grade', async () => {
    expect((await createClass({ name: '', grade: 5 })).statusCode).toBe(400);
    expect((await createClass({ name: '5Б', grade: 12 })).statusCode).toBe(400);
  });
});

describe('pasting a roster', () => {
  it('adds 30 students with unique codes, in alphabetical order', async () => {
    const classId = (await newClass()).id;
    const res = await addStudents(classId, CLASS_OF_30);
    expect(res.statusCode).toBe(200);
    const body = AddStudentsResponseSchema.parse(res.json());
    expect(body.added).toBe(30);
    expect(body.skipped).toEqual([]);
    expect(body.students).toHaveLength(30);

    const codes = body.students.map((s) => s.code.join('+'));
    expect(new Set(codes).size).toBe(30);
    // Grade 5 gets digit codes (grades 1–2 get pictures).
    expect(body.students[0]?.codeKind).toBe('digits');

    const names = body.students.map((s) => s.lastName);
    expect([...names].sort((a, b) => a.localeCompare(b, 'ru'))).toEqual(names);
    expect(body.students.map((s) => s.sortOrder)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it('gives picture codes to the first grade', async () => {
    const classId = (await newClass({ name: '1Б', grade: 1 })).id;
    const body = AddStudentsResponseSchema.parse(
      (await addStudents(classId, 'Алиев\tТимур')).json(),
    );
    expect(body.students[0]?.codeKind).toBe('pics');
    expect(body.students[0]?.code).toHaveLength(2);
  });

  it('skips names already in the class instead of duplicating them', async () => {
    const classId = (await newClass()).id;
    await addStudents(classId, 'Алиев\tТимур\nКаримова\tМадина');
    const again = AddStudentsResponseSchema.parse(
      (await addStudents(classId, 'алиев\tтимур\nНовиков\tЕгор')).json(),
    );
    expect(again.added).toBe(1);
    expect(again.skipped).toEqual(['алиев тимур']);
    expect(again.students).toHaveLength(3);
  });

  it('refuses to go past the class limit and says why', async () => {
    const classId = (await newClass()).id;
    const many = Array.from({ length: MAX_STUDENTS_PER_CLASS }, (_, i) => {
      const letters = [...'абвгдежзийклмнопрстуфхцчшщэюя'];
      const suffix = `${letters[Math.floor(i / letters.length)] ?? ''}${letters[i % letters.length] ?? ''}`;
      return `Фамилия${suffix}\tИмя${suffix}`;
    }).join('\n');
    expect((await addStudents(classId, many)).statusCode).toBe(200);
    const over = await addStudents(classId, 'Лишний\tУченик');
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({ error: 'class_full' });
  });
});

describe('fixing and removing a student', () => {
  it('renames and reorders the register', async () => {
    const classId = (await newClass()).id;
    const added = AddStudentsResponseSchema.parse(
      (await addStudents(classId, 'Яковлев\tИван\nАлиев\tТимур')).json(),
    );
    const last = added.students[1];
    if (!last) throw new Error('no second student');
    expect(last.lastName).toBe('Яковлев');

    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/students/${last.id}`,
      headers: { cookie },
      payload: { lastName: 'Абрамов' },
    });
    expect(res.statusCode).toBe(200);
    const after = ClassDetailsResponseSchema.parse(res.json());
    expect(after.students.map((s) => s.lastName)).toEqual(['Абрамов', 'Алиев']);
    expect(after.students.map((s) => s.sortOrder)).toEqual([1, 2]);
  });

  it('deletes a student who never took part in a lesson', async () => {
    const classId = (await newClass()).id;
    const added = AddStudentsResponseSchema.parse(
      (await addStudents(classId, 'Алиев\tТимур\nКаримова\tМадина')).json(),
    );
    const victim = added.students[0];
    if (!victim) throw new Error('no student');
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/students/${victim.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const after = ClassDetailsResponseSchema.parse(res.json());
    expect(after.students).toHaveLength(1);
    expect(after.students[0]?.lastName).toBe('Каримова');
  });

  it('only switches off a student who already has a lesson history', async () => {
    // The demo class has attendance as soon as a lesson ends; write one row directly.
    const student = t.database.db
      .select()
      .from((await import('../src/db/index.js')).schema.students)
      .all()[0];
    if (!student) throw new Error('no demo students');
    const { schema } = await import('../src/db/index.js');
    const session = SessionResponseSchema.parse(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: { cookie },
          payload: { classId: DEMO.classId, lessonId: 'g10' },
        })
      ).json(),
    ).session;
    t.database.db
      .insert(schema.attendance)
      .values({ sessionId: session.id, studentId: student.id, status: 'present', joinedAt: null })
      .run();

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/students/${student.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const after = ClassDetailsResponseSchema.parse(res.json());
    const kept = after.students.find((s) => s.id === student.id);
    expect(kept?.isActive).toBe(false);
  });
});

describe('access boundary of the new routes', () => {
  it('hides another teacher class from the roster routes', async () => {
    const classId = (await newClass()).id;
    const added = AddStudentsResponseSchema.parse(
      (await addStudents(classId, 'Алиев\tТимур')).json(),
    );
    const studentId = added.students[0]?.id as string;
    const outsider = await registerOutsider();

    const attempts = [
      {
        method: 'POST' as const,
        url: `/api/classes/${classId}/students`,
        payload: { students: [{ lastName: 'Чужой', firstName: 'Ученик' }] },
      },
      {
        method: 'PATCH' as const,
        url: `/api/students/${studentId}`,
        payload: { lastName: 'Взлом' },
      },
      { method: 'DELETE' as const, url: `/api/students/${studentId}` },
    ];
    for (const attempt of attempts) {
      const res = await t.app.inject({ ...attempt, headers: { cookie: outsider } });
      expect(`${attempt.method} ${attempt.url} → ${res.statusCode}`).toBe(
        `${attempt.method} ${attempt.url} → 404`,
      );
    }
    // Nothing of it changed.
    const mine = ClassDetailsResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: `/api/classes/${classId}`, headers: { cookie } })
      ).json(),
    );
    expect(mine.students).toHaveLength(1);
    expect(mine.students[0]?.lastName).toBe('Алиев');
  });
});
