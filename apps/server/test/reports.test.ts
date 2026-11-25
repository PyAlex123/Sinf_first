import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  ClassReportSchema,
  JournalSchema,
  SchoolReportSchema,
  SessionResponseSchema,
  type Journal,
} from '@sinf/shared';
import { loginTeacher, registerTeacher, testApp, type TestApp } from './helpers.js';

/** B1 (stage 6): reports by class, by parallel and by child, from the journal. */

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

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  payload?: object,
  as = cookie,
) => t.app.inject({ method, url, headers: { cookie: as }, ...(payload ? { payload } : {}) });

async function gradeColumn(date: string, title: string, marks: Record<string, number | 'н'>) {
  const j: Journal = JournalSchema.parse(
    (await call('POST', '/api/journal/class-1a/columns', { date, title })).json(),
  );
  const column = {
    kind: 'manual',
    columnId: j.lessons.find((l) => l.lessonTitle === title)?.columnId,
  };
  for (const [studentId, mark] of Object.entries(marks)) {
    await call(
      'PUT',
      '/api/journal/class-1a/cell',
      mark === 'н' ? { column, studentId, absent: true } : { column, studentId, value: mark },
    );
  }
}

describe('reports', () => {
  it('count lessons, attendance, grades and the KTP of the period, by class and parallel', async () => {
    // A lesson with two children of twenty.
    const started = await call('POST', '/api/sessions', { classId: 'class-1a', lessonId: 'g10' });
    const { session } = SessionResponseSchema.parse(started.json());
    for (const [id, first, last] of [
      ['student-01', 'Тимур', 'Алиев'],
      ['student-02', 'Мадина', 'Каримова'],
    ] as const) {
      t.app.sessions.loginStudent(session.id, {
        id,
        firstName: first,
        lastName: last,
        sortOrder: 1,
        pc: null,
      });
    }
    await call('POST', `/api/sessions/${session.id}/end`);
    await call('PUT', `/api/sessions/${session.id}/grades`, {
      grades: [{ studentId: 'student-01', value: 5 }],
    });
    const today = session.startedAt.slice(0, 10);
    // Grades by hand, today and long ago.
    await gradeColumn(today, 'Устно', { 'student-01': 4, 'student-02': 3, 'student-03': 'н' });
    await gradeColumn('2000-01-10', 'Давно', { 'student-01': 2 });
    // A KTP: two topics due long ago, one of them done.
    const plan = (
      await call('POST', '/api/ktp', {
        classId: 'class-1a',
        title: 'Информатика',
        rows: [
          { topic: 'Первая', weekOrDate: '01.09.2000' },
          { topic: 'Вторая', weekOrDate: '08.09.2000' },
          { topic: 'Третья', weekOrDate: '' },
        ],
      })
    ).json<{ id: string; items: { id: string }[] }>();
    await call('PATCH', `/api/ktp/${plan.id}/rows/${plan.items[0]?.id}`, { isDone: true });

    const period = `from=2001-01-01&to=2999-12-31`;
    const res = await call('GET', `/api/schools/school-demo/reports?${period}`);
    expect(res.statusCode).toBe(200);
    const report = SchoolReportSchema.parse(res.json());
    const row = report.classes.find((c) => c.classId === 'class-1a');
    expect(row).toMatchObject({
      students: 20,
      lessons: 1,
      // 2 of 20 at the one lesson.
      attendance: 10,
      grades: { five: 1, four: 1, three: 1, two: 0 },
      average: 4,
      ktp: { rows: 3, done: 1, planned: 2 },
    });
    expect(report.parallels).toMatchObject([{ classId: null, grade: 1, lessons: 1, students: 20 }]);

    // The long-ago column only in a period that has it.
    const old = SchoolReportSchema.parse(
      (await call('GET', '/api/schools/school-demo/reports?from=2000-01-01&to=2000-12-31')).json(),
    );
    expect(old.classes[0]).toMatchObject({ lessons: 0, attendance: null, grades: { two: 1 } });

    const cls = ClassReportSchema.parse(
      (await call('GET', `/api/classes/class-1a/report?${period}`)).json(),
    );
    expect(cls.students.find((s) => s.id === 'student-01')).toMatchObject({
      present: 1,
      lessons: 1,
      grades: { five: 1, four: 1 },
      average: 4.5,
    });
    expect(cls.students.find((s) => s.id === 'student-03')).toMatchObject({
      present: 0,
      lessons: 1,
    });

    const xlsx = await call('GET', `/api/schools/school-demo/reports.xlsx?${period}&lang=ru`);
    expect(xlsx.statusCode).toBe(200);
    const sheet = strFromU8(
      unzipSync(new Uint8Array(xlsx.rawPayload))['xl/worksheets/sheet1.xml']!,
    );
    expect(sheet).toContain('Посещаемость, %');
    expect(sheet).toContain('1А');
    expect((await call('GET', `/api/classes/class-1a/report.xlsx?${period}`)).statusCode).toBe(200);
  });

  it('are the administrator’s for the school and the class’s teacher’s for the class', async () => {
    const other = await registerTeacher(t.app);
    expect(
      (await call('GET', '/api/schools/school-demo/reports', undefined, other)).statusCode,
    ).toBe(404);
    expect((await call('GET', '/api/classes/class-1a/report', undefined, other)).statusCode).toBe(
      404,
    );
    expect(
      (await call('GET', '/api/schools/school-demo/reports?from=2026-02-01&to=2026-01-01'))
        .statusCode,
    ).toBe(400);
    // No period: the school year so far.
    const year = SchoolReportSchema.parse(
      (await call('GET', '/api/schools/school-demo/reports')).json(),
    );
    expect(year.from.slice(5)).toBe('09-01');
  });
});
