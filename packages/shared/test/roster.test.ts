import { describe, expect, it } from 'vitest';
import { MAX_STUDENTS_PER_CLASS, parseRoster } from '../src/roster.js';

/** What teachers really paste: a column out of Excel, a numbered list out of Word, a hand-typed list. */

describe('parseRoster', () => {
  it('reads two columns from Excel', () => {
    const { students, problems } = parseRoster('Алиев\tТимур\nКаримова\tМадина\n');
    expect(students).toEqual([
      { lastName: 'Алиев', firstName: 'Тимур' },
      { lastName: 'Каримова', firstName: 'Мадина' },
    ]);
    expect(problems).toEqual([]);
  });

  it('reads one column of "Фамилия Имя"', () => {
    const { students } = parseRoster('Алиев Тимур\nКаримова Мадина');
    expect(students).toHaveLength(2);
    expect(students[1]).toEqual({ lastName: 'Каримова', firstName: 'Мадина' });
  });

  it('drops the row number, the header and the patronymic', () => {
    const { students, problems } = parseRoster(
      ['№\tФамилия Имя Отчество', '1. Алиев Тимур Рустамович', '2) Каримова Мадина Акбаровна'].join(
        '\n',
      ),
    );
    expect(students).toEqual([
      { lastName: 'Алиев', firstName: 'Тимур' },
      { lastName: 'Каримова', firstName: 'Мадина' },
    ]);
    expect(problems).toEqual([]);
  });

  it('keeps hyphens and apostrophes inside names', () => {
    const { students, problems } = parseRoster(
      "Абдуллаев Жасур\nO'Коннор Анна\nПетрова-Сидорова Яна",
    );
    expect(problems).toEqual([]);
    expect(students.map((s) => s.lastName)).toEqual(['Абдуллаев', "O'Коннор", 'Петрова-Сидорова']);
  });

  it('skips blank lines and trailing spaces', () => {
    const { students, problems } = parseRoster('\n  Алиев\tТимур  \n\n\t\n  ');
    expect(students).toEqual([{ lastName: 'Алиев', firstName: 'Тимур' }]);
    expect(problems).toEqual([]);
  });

  it('reports a row with only one word instead of guessing', () => {
    const { students, problems } = parseRoster('Алиев Тимур\nКаримова');
    expect(students).toHaveLength(1);
    expect(problems).toEqual([{ line: 2, text: 'Каримова', reason: 'incomplete' }]);
  });

  it('reports a row that holds no name at all', () => {
    const { students, problems } = parseRoster('Алиев Тимур\n12345 ???');
    expect(students).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 2, reason: 'unreadable' });
  });

  it('reports a repeated name instead of adding it twice', () => {
    const { students, problems } = parseRoster('Алиев Тимур\nКаримова Мадина\nалиев тимур');
    expect(students).toHaveLength(2);
    expect(problems).toEqual([{ line: 3, text: 'алиев тимур', reason: 'duplicate' }]);
  });

  it('reads a semicolon-separated list', () => {
    const { students } = parseRoster('Алиев; Тимур\nКаримова; Мадина');
    expect(students).toHaveLength(2);
    expect(students[0]).toEqual({ lastName: 'Алиев', firstName: 'Тимур' });
  });

  it('reads a whole class of 30 and keeps the order', () => {
    // Names never carry digits, so the generated ones use letter suffixes, all 30 different.
    const letters = [...'абвгдежзийклмнопрстуфхцчшщэюя'];
    const suffix = (i: number): string =>
      `${letters[Math.floor(i / letters.length)] ?? ''}${letters[i % letters.length] ?? ''}`;
    const lines = Array.from(
      { length: 30 },
      (_, i) => `${i + 1}.\tИванов${suffix(i)}\tПётр${suffix(i)}`,
    );
    const { students, problems } = parseRoster(lines.join('\n'));
    expect(problems).toEqual([]);
    expect(students).toHaveLength(30);
    expect(new Set(students.map((s) => s.lastName)).size).toBe(30);
    expect(students.length).toBeLessThanOrEqual(MAX_STUDENTS_PER_CLASS);
  });

  it('calls a cell with digits unreadable: "5Б" or "2024" is not a name', () => {
    const { students, problems } = parseRoster('5Б\t2024\nАлиев Тимур');
    expect(students).toEqual([{ lastName: 'Алиев', firstName: 'Тимур' }]);
    expect(problems[0]).toMatchObject({ line: 1, reason: 'unreadable' });
  });
});
