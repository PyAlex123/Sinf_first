import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClassDetailsResponseSchema,
  headerDate,
  JournalSchema,
  matchStudent,
  ParsedTablesSchema,
  readGradeCell,
  type ImportGrades,
} from '@sinf/shared';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** W13 (PLAN.md 5.5): grades a teacher kept in Excel, into the journal. */

const FILE = join(import.meta.dirname, 'fixtures', 'grades', 'grades.xlsx');
const TODAY = new Date(Date.UTC(2026, 10, 21));

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

describe('grades from a file', () => {
  it('match the children by name, ask about the doubtful, and land as journal columns', async () => {
    const parsed = await t.app.inject({
      method: 'POST',
      url: '/api/tables/parse?name=grades.xlsx',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: readFileSync(FILE),
    });
    expect(parsed.statusCode).toBe(200);
    const rows = ParsedTablesSchema.parse(parsed.json()).tables[0]?.rows ?? [];
    const [, header, ...body] = rows;
    expect(header).toEqual(['№', 'Ф.И.О.', '05.11', '12.11', 'Контрольная']);

    const details = ClassDetailsResponseSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/classes/class-1a', headers: { cookie } })
      ).json(),
    );
    const roster = details.students.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
    }));
    const matches = body.map((r) => matchStudent(r[1] ?? '', roster));
    expect(matches.map((m) => m.status)).toEqual([
      'exact',
      'exact',
      'exact',
      'exact',
      'doubt', // "Мирзаев Азз": a typo in the name
      'doubt', // "Петров Сергей": only "Петрова Алина" is near
    ]);

    // The teacher confirms Мирзаев and skips Петров.
    const ids = matches.map((m, i) => (i === 4 ? (m.candidates[0] ?? null) : m.studentId));
    const columns: ImportGrades['columns'] = [2, 3, 4].map((c) => ({
      date: headerDate(header?.[c] ?? '', TODAY) ?? '2026-11-20',
      title: headerDate(header?.[c] ?? '', TODAY) ? 'Из файла' : (header?.[c] ?? ''),
      cells: body.flatMap((r, i) => {
        const studentId = ids[i];
        const cell = readGradeCell(r[c] ?? '');
        return studentId && cell ? [{ studentId, ...cell }] : [];
      }),
    }));
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/journal/class-1a/import',
      headers: { cookie },
      payload: { columns },
    });
    expect(res.statusCode).toBe(200);
    const journal = JournalSchema.parse(res.json());
    expect(journal.lessons.map((l) => [l.date, l.lessonTitle])).toEqual([
      ['2026-11-05', 'Из файла'],
      ['2026-11-12', 'Из файла'],
      ['2026-11-20', 'Контрольная'],
    ]);
    const cells = (name: string) =>
      journal.students
        .find((s) => s.name.startsWith(name))
        ?.cells.map((c) => (c?.present ? c.grade : 'н'));
    expect(cells('Алиев')).toEqual([5, 4, 5]);
    expect(cells('Каримова')).toEqual([4, 'н', 4]);
    expect(cells('Иванов')).toEqual([3, null, 'н']);
    expect(cells('Мирзаев')).toEqual([4, 4, 3]);
    expect(cells('Петрова')).toEqual([null, null, null]);
  });

  it('refuses a child of another class, and keeps nothing then', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/journal/class-1a/import',
      headers: { cookie },
      payload: {
        columns: [
          {
            date: '2026-11-05',
            title: 'Из файла',
            cells: [
              { studentId: 'student-01', value: 5, absent: false },
              { studentId: 'nobody', value: 5, absent: false },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(404);
    const journal = JournalSchema.parse(
      (
        await t.app.inject({ method: 'GET', url: '/api/journal/class-1a', headers: { cookie } })
      ).json(),
    );
    expect(journal.lessons).toEqual([]);
  });
});
