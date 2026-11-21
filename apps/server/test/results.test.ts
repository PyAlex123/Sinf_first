import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClassDetailsResponseSchema,
  JournalSchema,
  lessonDate,
  SessionResponseSchema,
  SessionResultsSchema,
} from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { asciiFileName } from '../src/routes/results.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';
import { expectWellFormed } from './xml.js';

/**
 * S1.13: lesson results, the class journal and its Excel file. The rows a lesson leaves behind are
 * written straight into the tables here — the websocket path that writes them in a real lesson is
 * covered by realtime.test.ts.
 */

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

async function startSession(lessonId: string): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { classId: 'class-1a', lessonId },
  });
  expect(res.statusCode).toBe(200);
  return SessionResponseSchema.parse(res.json()).session.id;
}

async function join(sessionId: string, studentId: string): Promise<void> {
  const row = t.database.db
    .select()
    .from(schema.students)
    .all()
    .find((s) => s.id === studentId);
  if (!row) throw new Error('no such student');
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/join',
    payload: { sessionId, studentId, code: row.codePublic.split('+') },
  });
  expect(res.statusCode).toBe(200);
}

async function endSession(sessionId: string): Promise<void> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/end`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
}

const at = '2026-11-20T05:00:00.000Z';

function screenStars(sessionId: string, studentId: string, stars: number[]): void {
  t.database.db
    .insert(schema.screenResults)
    .values(
      stars.map((s, i) => ({
        sessionId,
        studentId,
        screenIndex: 100 + i,
        stars: s,
        firstAt: at,
        lastAt: at,
      })),
    )
    .run();
}

function quizAnswer(
  sessionId: string,
  studentId: string,
  questionIndex: number,
  correct: boolean,
  points: number,
): void {
  t.database.db
    .insert(schema.quizAttempts)
    .values({
      id: `${sessionId}-${studentId}-${questionIndex}`,
      sessionId,
      studentId,
      questionIndex,
      optionIndex: correct ? 1 : 0,
      correct,
      timeMs: 3000,
      points,
      at,
    })
    .run();
}

function drawingStars(sessionId: string, studentId: string, stars: number): void {
  t.database.db
    .insert(schema.practiceResults)
    .values({ sessionId, studentId, stars, stepsDone: 12, at })
    .run();
}

async function results(sessionId: string, as = cookie) {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/results`,
    headers: { cookie: as },
  });
  expect(res.statusCode).toBe(200);
  return SessionResultsSchema.parse(res.json());
}

async function setStarsToGrade(value: boolean, as = cookie) {
  return t.app.inject({
    method: 'PATCH',
    url: '/api/classes/class-1a/settings',
    headers: { cookie: as },
    payload: { starsToGrade: value },
  });
}

/** g10: two children in, the rest away; trainer stars and two quiz questions. */
async function lessonG10(): Promise<string> {
  const id = await startSession('g10');
  await join(id, 'student-01'); // Алиев Тимур
  await join(id, 'student-02'); // Каримова Мадина
  screenStars(id, 'student-01', [2, 3]);
  quizAnswer(id, 'student-01', 0, true, 900);
  quizAnswer(id, 'student-01', 1, false, 0);
  quizAnswer(id, 'student-02', 0, true, 700);
  return id;
}

describe('lesson results', () => {
  it('shows the class on one screen: who came, stars, quiz (S1.13)', async () => {
    const id = await lessonG10();

    // While the lesson goes on, only those who came in are known.
    const live = await results(id);
    expect(live.status).toBe('active');
    expect(live.rows.map((r) => r.name)).toEqual(['Алиев Тимур', 'Каримова Мадина']);

    await endSession(id);
    const r = await results(id);
    expect(r.status).toBe('ended');
    expect(r.lessonId).toBe('g10');
    expect(r.date).toBe(lessonDate(r.startedAt));
    expect(r.class).toEqual({
      id: 'class-1a',
      name: '1А',
      starsToGrade: false,
      thresholds: { five: 90, four: 70, three: 50 },
    });
    expect(r.rows).toHaveLength(20);
    expect(r.presentCount).toBe(2);
    // The register's order: Абдуллаев comes first, and he stayed at home.
    expect(r.rows[0]).toMatchObject({ name: 'Абдуллаев Жасур', present: false, totalStars: 0 });

    // g10: nine levels and three typed words — 16 stars; one Paint slide, but no drawing stars
    // given, so the drawing does not count; two quiz questions were asked.
    expect(r.maxima).toEqual({ trainer: 16, practice: 0, quiz: 2 });
    expect(r.practiceSteps).toBe(1);
    expect(r.quizQuestions).toBe(6);

    const alievRow = r.rows.find((row) => row.studentId === 'student-01');
    expect(alievRow).toMatchObject({
      present: true,
      trainerStars: 5,
      screensDone: 2,
      practiceStars: null,
      quizPoints: 900,
      quizCorrect: 1,
      quizAnswered: 2,
      totalStars: 5,
      // (5 + 1) of (16 + 2) → 33 %.
      percent: 33,
      // 1А does not turn stars into grades.
      grade: null,
    });
    const away = r.rows.find((row) => row.studentId === 'student-05');
    expect(away).toMatchObject({ present: false, percent: null, grade: null });
  });

  it('gives a 2–5 grade once the class turns it on, and only to those present', async () => {
    const id = await lessonG10();
    await endSession(id);

    const res = await setStarsToGrade(true);
    expect(res.statusCode).toBe(200);
    const details = ClassDetailsResponseSchema.parse(res.json());
    expect(details.class.settings.starsToGrade).toBe(true);
    expect(details.canEditSettings).toBe(true);

    const r = await results(id);
    expect(r.class.starsToGrade).toBe(true);
    // Алиев: 33 % → 2. Каримова: one right answer of 18 possible → 6 % → 2.
    expect(r.rows.find((row) => row.studentId === 'student-01')?.grade).toBe(2);
    expect(r.rows.find((row) => row.studentId === 'student-02')).toMatchObject({
      percent: 6,
      grade: 2,
    });
    expect(r.rows.find((row) => row.studentId === 'student-05')?.grade).toBeNull();
  });

  it('counts the drawing once the teacher gives stars for it', async () => {
    const id = await startSession('k10');
    await join(id, 'student-01');
    await join(id, 'student-02');
    screenStars(id, 'student-01', [1, 1, 1]);
    drawingStars(id, 'student-01', 3);
    await endSession(id);
    await setStarsToGrade(true);

    const r = await results(id);
    // k10: three typed words and sixteen Paint steps.
    expect(r.maxima).toEqual({ trainer: 3, practice: 3, quiz: 0 });
    expect(r.practiceSteps).toBe(16);
    expect(r.rows.find((row) => row.studentId === 'student-01')).toMatchObject({
      trainerStars: 3,
      practiceStars: 3,
      totalStars: 6,
      percent: 100,
      grade: 5,
    });
    // No stars for her drawing yet: the steps still come from the lesson's last snapshot.
    expect(r.rows.find((row) => row.studentId === 'student-02')).toMatchObject({
      practiceStars: null,
      stepsDone: 0,
      percent: 0,
    });
  });
});

describe('class journal', () => {
  it('puts children down and lessons across, oldest first', async () => {
    const first = await lessonG10();
    await endSession(first);
    const second = await startSession('k10');
    await join(second, 'student-01');
    drawingStars(second, 'student-01', 2);
    // A lesson still going on is not in the journal yet.
    const res0 = await t.app.inject({
      method: 'GET',
      url: '/api/journal/class-1a',
      headers: { cookie },
    });
    expect(JournalSchema.parse(res0.json()).lessons).toHaveLength(1);
    await endSession(second);

    // A child who came after these lessons has empty cells, not absences.
    const added = await t.app.inject({
      method: 'POST',
      url: '/api/classes/class-1a/students',
      headers: { cookie },
      payload: { students: [{ lastName: 'Аминов', firstName: 'Карим' }] },
    });
    expect(added.statusCode).toBe(200);

    const res = await t.app.inject({
      method: 'GET',
      url: '/api/journal/class-1a',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const journal = JournalSchema.parse(res.json());
    expect(journal.lessons.map((l) => l.lessonId)).toEqual(['g10', 'k10']);
    expect(journal.students).toHaveLength(21);
    expect(journal.students.slice(0, 3).map((s) => s.name)).toEqual([
      'Абдуллаев Жасур',
      'Алиев Тимур',
      'Аминов Карим',
    ]);
    const aliev = journal.students.find((s) => s.id === 'student-01');
    expect(aliev?.cells).toEqual([
      { present: true, stars: 5, grade: null, confirmed: false },
      { present: true, stars: 2, grade: null, confirmed: false },
    ]);
    const karimova = journal.students.find((s) => s.id === 'student-02');
    expect(karimova?.cells).toEqual([
      { present: true, stars: 0, grade: null, confirmed: false },
      { present: false, stars: 0, grade: null, confirmed: false },
    ]);
    expect(journal.students.find((s) => s.name === 'Аминов Карим')?.cells).toEqual([null, null]);
  });

  it('keeps a child who left the class in the lessons they sat', async () => {
    const id = await lessonG10();
    await endSession(id);
    const removed = await t.app.inject({
      method: 'DELETE',
      url: '/api/students/student-01',
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/journal/class-1a',
      headers: { cookie },
    });
    const aliev = JournalSchema.parse(res.json()).students.find((s) => s.id === 'student-01');
    expect(aliev).toMatchObject({ isActive: false, cells: [{ present: true, stars: 5 }] });
  });
});

describe('journal in Excel', () => {
  async function download(query = '') {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/journal/class-1a/export.xlsx${query}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const parts = unzipSync(new Uint8Array(res.rawPayload));
    const sheet = parts['xl/worksheets/sheet1.xml'];
    if (!sheet) throw new Error('no sheet');
    return { res, sheet: strFromU8(sheet), parts };
  }

  it('is an .xlsx with names in register order, the date, stars and absences', async () => {
    const id = await lessonG10();
    await endSession(id);
    const { res, sheet, parts } = await download();
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe('attachment; filename="zhurnal-1A.xlsx"');
    for (const part of Object.values(parts)) expectWellFormed(strFromU8(part));

    const r = await results(id);
    const [y, m, d] = r.date.split('-');
    expect(sheet).toContain(`${d}.${m}.${y}`);
    expect(sheet).toContain(r.lessonTitle);
    // Row 3 is the first child: Абдуллаев, absent. Row 4 is Алиев with 5 stars.
    expect(sheet).toMatch(
      /<row r="3"><c r="A3"><v>1<\/v><\/c><c r="B3" t="inlineStr"><is><t xml:space="preserve">Абдуллаев Жасур<\/t><\/is><\/c><c r="C3" s="2" t="inlineStr"><is><t xml:space="preserve">н<\/t>/,
    );
    expect(sheet).toContain('<c r="C4" s="2"><v>5</v></c>');
    expect(sheet).toContain('В клетке — звёзды за урок');
  });

  it('carries grades when the class has them, and speaks Uzbek on request', async () => {
    const id = await lessonG10();
    await endSession(id);
    await setStarsToGrade(true);
    const { res, sheet } = await download('?lang=uz');
    expect(res.headers['content-disposition']).toBe('attachment; filename="jurnal-1A.xlsx"');
    expect(sheet).toContain('O‘quvchi');
    expect(sheet).toContain('yo‘q');
    // Алиев: 33 % → 2.
    expect(sheet).toContain('<c r="C4" s="2"><v>2</v></c>');
    expect(sheet).toContain('2–5 baho');
  });

  it('refuses a language it does not have', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/journal/class-1a/export.xlsx?lang=en',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('asciiFileName', () => {
  it('spells Cyrillic in Latin letters and keeps the name readable', () => {
    expect(asciiFileName('zhurnal-1А.xlsx')).toBe('zhurnal-1A.xlsx');
    expect(asciiFileName('jurnal-8Б.xlsx')).toBe('jurnal-8B.xlsx');
    expect(asciiFileName('zhurnal-Щука Ёж.xlsx')).toBe('zhurnal-Shchuka-Yozh.xlsx');
    expect(asciiFileName('jurnal-5“Ғ”.xlsx')).toBe('jurnal-5-G-.xlsx');
  });
});

describe('who may see results and change settings', () => {
  async function outsider(): Promise<string> {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'Чужой Учитель', email: 'other@example.com', password: 'parol12345' },
    });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === 'sinf_teacher');
    if (!c) throw new Error('no cookie');
    return `${c.name}=${c.value}`;
  }

  it('answers 404 to a teacher from outside, as for anything of another class', async () => {
    const id = await lessonG10();
    await endSession(id);
    const other = await outsider();
    for (const url of [
      `/api/sessions/${id}/results`,
      '/api/journal/class-1a',
      '/api/journal/class-1a/export.xlsx',
    ]) {
      const res = await t.app.inject({ method: 'GET', url, headers: { cookie: other } });
      expect(res.statusCode, url).toBe(404);
    }
    expect((await setStarsToGrade(true, other)).statusCode).toBe(404);
  });

  it('lets a colleague from the school read the journal but not change the class', async () => {
    const other = await outsider();
    const user = t.database.db
      .select()
      .from(schema.users)
      .all()
      .find((u) => u.email === 'other@example.com');
    const cls = t.database.db
      .select()
      .from(schema.classes)
      .all()
      .find((c) => c.id === 'class-1a');
    if (!user || !cls?.schoolId) throw new Error('setup');
    t.database.db
      .insert(schema.schoolMembers)
      .values({ schoolId: cls.schoolId, userId: user.id, role: 'teacher', createdAt: at })
      .run();

    const journal = await t.app.inject({
      method: 'GET',
      url: '/api/journal/class-1a',
      headers: { cookie: other },
    });
    expect(journal.statusCode).toBe(200);
    const details = await t.app.inject({
      method: 'GET',
      url: '/api/classes/class-1a',
      headers: { cookie: other },
    });
    expect(ClassDetailsResponseSchema.parse(details.json()).canEditSettings).toBe(false);
    const res = await setStarsToGrade(true, other);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'settings_locked' });
  });

  it('asks for a teacher at all', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/journal/class-1a' });
    expect(res.statusCode).toBe(401);
  });
});

describe('confirming grades (H10)', () => {
  const put = (
    sessionId: string,
    grades: { studentId: string; value: number | null }[],
    as = cookie,
  ) =>
    t.app.inject({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/grades`,
      headers: { cookie: as },
      payload: { grades },
    });
  const row = async (sessionId: string, studentId: string) =>
    (await results(sessionId)).rows.find((r) => r.studentId === studentId);

  async function lesson(): Promise<string> {
    await setStarsToGrade(true);
    const sessionId = await startSession('g10');
    await join(sessionId, 'student-01');
    await join(sessionId, 'student-02');
    screenStars(sessionId, 'student-01', [3, 3]);
    screenStars(sessionId, 'student-02', [1]);
    return sessionId;
  }

  it('offers the calculated grade until the teacher confirms or changes it', async () => {
    const sessionId = await lesson();
    await endSession(sessionId);
    const before = await row(sessionId, 'student-01');
    expect(before?.suggestedGrade).not.toBeNull();
    expect(before).toMatchObject({ grade: before?.suggestedGrade, gradeConfirmed: false });

    // Taken as offered: a confirmed "session" grade.
    const suggested = before?.suggestedGrade ?? 2;
    expect((await put(sessionId, [{ studentId: 'student-01', value: suggested }])).statusCode).toBe(
      200,
    );
    expect(await row(sessionId, 'student-01')).toMatchObject({
      grade: suggested,
      gradeConfirmed: true,
    });
    const other = suggested === 5 ? 4 : 5;
    await put(sessionId, [{ studentId: 'student-01', value: other }]);
    expect(await row(sessionId, 'student-01')).toMatchObject({
      grade: other,
      suggestedGrade: suggested,
      gradeConfirmed: true,
    });
    const stored = t.database.db.select().from(schema.grades).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ value: other, source: 'manual', sessionId });

    // The journal carries the teacher's grade and says which cells are still suggestions.
    const journal = JournalSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/journal/class-1a', headers: { cookie } })
      ).json(),
    );
    const cellOf = (id: string) => journal.students.find((s) => s.id === id)?.cells[0];
    expect(cellOf('student-01')).toMatchObject({ grade: other, confirmed: true });
    expect(cellOf('student-02')).toMatchObject({ confirmed: false });

    // Null takes it back to the suggestion.
    await put(sessionId, [{ studentId: 'student-01', value: null }]);
    expect(await row(sessionId, 'student-01')).toMatchObject({
      grade: suggested,
      gradeConfirmed: false,
    });
    expect(t.database.db.select().from(schema.grades).all()).toHaveLength(0);
  });

  it('grades the whole class in one request', async () => {
    const sessionId = await lesson();
    await endSession(sessionId);
    const res = await put(sessionId, [
      { studentId: 'student-01', value: 5 },
      { studentId: 'student-02', value: 3 },
    ]);
    const rows = SessionResultsSchema.parse(res.json()).rows;
    expect(rows.filter((r) => r.gradeConfirmed).map((r) => [r.studentId, r.grade])).toEqual([
      ['student-01', 5],
      ['student-02', 3],
    ]);
  });

  it('refuses a running lesson, an absent child, a bad value and a stranger', async () => {
    const sessionId = await lesson();
    expect((await put(sessionId, [{ studentId: 'student-01', value: 5 }])).statusCode).toBe(409);
    await endSession(sessionId);
    expect((await put(sessionId, [{ studentId: 'student-03', value: 5 }])).statusCode).toBe(400);
    expect((await put(sessionId, [{ studentId: 'student-01', value: 6 }])).statusCode).toBe(400);
    expect((await put(sessionId, [])).statusCode).toBe(400);
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: `/api/sessions/${sessionId}/grades`,
          payload: { grades: [{ studentId: 'student-01', value: 5 }] },
        })
      ).statusCode,
    ).toBe(401);
    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'Чужой Учитель', email: 'other@example.com', password: 'parol12345' },
    });
    const c = reg.cookies.find((x) => x.name === 'sinf_teacher');
    expect(
      (await put(sessionId, [{ studentId: 'student-01', value: 5 }], `${c?.name}=${c?.value}`))
        .statusCode,
    ).toBe(404);
    expect(t.database.db.select().from(schema.grades).all()).toHaveLength(0);
  });
});
