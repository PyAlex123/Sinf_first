import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EmaktabRemindersResponseSchema,
  JournalSchema,
  lessonDate,
  SessionResponseSchema,
  type Journal,
} from '@sinf/shared';
import {
  applyJournal,
  journalOfClasses,
  markJournalSynced,
  pendingJournal,
} from '../src/services/journal.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** W9 (PLAN.md 5.1): the journal by hand — columns without a lesson, grades, "н", notes. */

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

const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => {
  const res = await t.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });
  return res;
};
const journal = (res: { json: () => unknown }): Journal => JournalSchema.parse(res.json());
const cellOf = (j: Journal, studentId: string, column: number) =>
  j.students.find((s) => s.id === studentId)?.cells[column];

describe('a column without a lesson', () => {
  it('takes grades, "н" and notes from the keyboard’s requests, and goes away whole', async () => {
    let j = journal(
      await call('POST', '/api/journal/class-1a/columns', {
        date: '2026-11-20',
        title: 'Контрольная',
      }),
    );
    expect(j.lessons).toMatchObject([
      { kind: 'manual', lessonTitle: 'Контрольная', date: '2026-11-20', sessionId: null },
    ]);
    const column = { kind: 'manual', columnId: j.lessons[0]?.columnId };
    // Everyone on the list has a cell waiting.
    expect(cellOf(j, 'student-01', 0)).toEqual({
      present: true,
      stars: 0,
      grade: null,
      confirmed: true,
      comment: null,
    });

    j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-01',
        value: 5,
      }),
    );
    expect(cellOf(j, 'student-01', 0)?.grade).toBe(5);
    j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-02',
        absent: true,
      }),
    );
    expect(cellOf(j, 'student-02', 0)).toMatchObject({ present: false, grade: null });
    // A grade after "н" takes its place.
    j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-02',
        value: 4,
      }),
    );
    expect(cellOf(j, 'student-02', 0)).toMatchObject({ present: true, grade: 4 });
    j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-01',
        comment: 'Без ошибок',
      }),
    );
    expect(cellOf(j, 'student-01', 0)).toMatchObject({ grade: 5, comment: 'Без ошибок' });
    j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-01',
        value: null,
      }),
    );
    expect(cellOf(j, 'student-01', 0)).toMatchObject({ grade: null, comment: 'Без ошибок' });

    // A grade outside 2–5 or a child of another class is refused.
    expect(
      (
        await call('PUT', '/api/journal/class-1a/cell', {
          column,
          studentId: 'student-01',
          value: 6,
        })
      ).statusCode,
    ).toBe(400);

    j = journal(await call('DELETE', `/api/journal/class-1a/columns/${column.columnId}`));
    expect(j.lessons).toEqual([]);
  });

  it('stands among the lessons by date', async () => {
    const started = await call('POST', '/api/sessions', { classId: 'class-1a', lessonId: 'g10' });
    const { session } = SessionResponseSchema.parse(started.json());
    await call('POST', `/api/sessions/${session.id}/end`);
    // The lesson's day in Tashkent, not in UTC: after 19:00 UTC it is already tomorrow there.
    const today = lessonDate(session.startedAt);
    await call('POST', '/api/journal/class-1a/columns', { date: '2000-01-01', title: 'Давно' });
    const j = journal(
      await call('POST', '/api/journal/class-1a/columns', { date: '2999-01-01', title: 'Потом' }),
    );
    expect(j.lessons.map((l) => l.kind)).toEqual(['manual', 'lesson', 'manual']);
    expect(j.lessons[1]?.date).toBe(today);
  });
});

describe('a lesson’s cell', () => {
  it('takes a grade after the lesson and a note, not "н"', async () => {
    const started = await call('POST', '/api/sessions', { classId: 'class-1a', lessonId: 'g10' });
    const { session } = SessionResponseSchema.parse(started.json());
    // The child joins through the store: the code is not the point here.
    t.app.sessions.loginStudent(session.id, {
      id: 'student-01',
      firstName: 'Тимур',
      lastName: 'Алиев',
      sortOrder: 1,
      pc: null,
    });
    const column = { kind: 'lesson', sessionId: session.id };
    expect(
      (
        await call('PUT', '/api/journal/class-1a/cell', {
          column,
          studentId: 'student-01',
          value: 5,
        })
      ).statusCode,
    ).toBe(409);
    await call('POST', `/api/sessions/${session.id}/end`);

    let j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-01',
        comment: 'Молодец',
      }),
    );
    expect(cellOf(j, 'student-01', 0)).toMatchObject({ comment: 'Молодец', confirmed: false });
    j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-01',
        value: 5,
      }),
    );
    expect(cellOf(j, 'student-01', 0)).toMatchObject({
      grade: 5,
      confirmed: true,
      comment: 'Молодец',
    });
    // Taking the grade back keeps the note.
    j = journal(
      await call('PUT', '/api/journal/class-1a/cell', {
        column,
        studentId: 'student-01',
        value: null,
      }),
    );
    expect(cellOf(j, 'student-01', 0)).toMatchObject({ confirmed: false, comment: 'Молодец' });
    expect(
      (
        await call('PUT', '/api/journal/class-1a/cell', {
          column,
          studentId: 'student-01',
          absent: true,
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('the exchange of the teacher’s columns', () => {
  it('sends what changed once, and the newer change wins on the other side', async () => {
    await call('POST', '/api/journal/class-1a/columns', { date: '2026-11-20', title: 'Устно' });
    const j = journal(await call('GET', '/api/journal/class-1a'));
    const column = { kind: 'manual', columnId: j.lessons[0]?.columnId };
    await call('PUT', '/api/journal/class-1a/cell', { column, studentId: 'student-01', value: 4 });

    const pending = pendingJournal(t.database.db);
    expect(pending.columns).toHaveLength(1);
    expect(pending.grades).toMatchObject([{ studentId: 'student-01', value: 4 }]);
    markJournalSynced(t.database.db, pending);
    expect(pendingJournal(t.database.db)).toEqual({ columns: [], grades: [] });

    // The other side has an older change of the same grade, and a newer one of another.
    const theirs = journalOfClasses(t.database.db, ['class-1a']);
    const older = { ...theirs.grades[0]!, value: 2, updatedAt: '2000-01-01T00:00:00.000Z' };
    const newer = {
      columnId: column.columnId ?? '',
      studentId: 'student-02',
      value: 5,
      absent: false,
      comment: null,
      updatedAt: '2999-01-01T00:00:00.000Z',
    };
    const applied = applyJournal(
      t.database.db,
      { columns: [], grades: [older, newer] },
      new Set(['class-1a']),
      true,
    );
    expect(applied).toBe(1);
    const after = journal(await call('GET', '/api/journal/class-1a'));
    expect([cellOf(after, 'student-01', 0)?.grade, cellOf(after, 'student-02', 0)?.grade]).toEqual([
      4, 5,
    ]);
    // A class this side does not know is not touched.
    expect(
      applyJournal(t.database.db, { columns: [], grades: [newer] }, new Set(['other']), true),
    ).toBe(0);
  });
});

describe('moving grades to eMaktab (W12)', () => {
  it('reminds of a column with grades until it is marked, and takes the mark back', async () => {
    const today = new Date().toISOString().slice(0, 10);
    let j = journal(
      await call('POST', '/api/journal/class-1a/columns', { date: today, title: 'Устно' }),
    );
    const column = { kind: 'manual', columnId: j.lessons[0]?.columnId };
    const reminders = async () =>
      EmaktabRemindersResponseSchema.parse((await call('GET', '/api/emaktab/reminders')).json())
        .reminders;
    // No grades yet: nothing to move.
    expect(await reminders()).toEqual([]);

    await call('PUT', '/api/journal/class-1a/cell', { column, studentId: 'student-01', value: 5 });
    await call('PUT', '/api/journal/class-1a/cell', { column, studentId: 'student-02', value: 4 });
    const due = await reminders();
    expect(due).toMatchObject([{ classId: 'class-1a', lessonTitle: 'Устно', grades: 2 }]);
    expect(due[0]?.hoursLeft).toBeGreaterThan(0);
    expect(due[0]?.hoursLeft).toBeLessThanOrEqual(72);

    j = journal(await call('PUT', '/api/journal/class-1a/emaktab', { column, done: true }));
    expect(j.lessons[0]?.emaktabAt).not.toBeNull();
    expect(await reminders()).toEqual([]);

    j = journal(await call('PUT', '/api/journal/class-1a/emaktab', { column, done: false }));
    expect(j.lessons[0]?.emaktabAt).toBeNull();
    expect(await reminders()).toHaveLength(1);

    // A column of another class is not this journal's.
    expect(
      (
        await call('PUT', '/api/journal/class-1a/emaktab', {
          column: { kind: 'manual', columnId: 'nope' },
          done: true,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('does not remind of a day eMaktab no longer takes', async () => {
    const j = journal(
      await call('POST', '/api/journal/class-1a/columns', { date: '2000-01-01', title: 'Давно' }),
    );
    const column = { kind: 'manual', columnId: j.lessons[0]?.columnId };
    await call('PUT', '/api/journal/class-1a/cell', { column, studentId: 'student-01', value: 5 });
    const res = EmaktabRemindersResponseSchema.parse(
      (await call('GET', '/api/emaktab/reminders')).json(),
    );
    expect(res.reminders).toEqual([]);
  });
});
