import { describe, expect, it } from 'vitest';
import { headerDate, matchStudent, readGradeCell } from '../src/index.js';

/** W13: whose row is it, and what does a cell say. */

const roster = [
  { id: 'a', lastName: 'Алиев', firstName: 'Тимур' },
  { id: 'b', lastName: 'Алиева', firstName: 'Мадина' },
  { id: 'c', lastName: 'Ким', firstName: 'Даниил' },
  { id: 'd', lastName: 'Ким', firstName: 'Дарья' },
  { id: 'e', lastName: 'Иванов', firstName: 'Артём' },
];

describe('matching a name to the class', () => {
  it('is sure of the name in either order, in capitals, with a patronymic or an initial', () => {
    for (const name of [
      'Алиев Тимур',
      'Тимур Алиев',
      'АЛИЕВ ТИМУР',
      'Алиев Тимур Рустамович',
      'Алиев Т.',
    ]) {
      expect(matchStudent(name, roster), name).toMatchObject({ studentId: 'a', status: 'exact' });
    }
    expect(matchStudent('Иванов Артем', roster)).toMatchObject({ studentId: 'e', status: 'exact' });
  });

  it('asks about a typo, and a surname shared by two children', () => {
    expect(matchStudent('Алеев Тимур', roster)).toMatchObject({
      studentId: null,
      status: 'doubt',
      candidates: ['a'],
    });
    expect(matchStudent('Ким', roster)).toMatchObject({ status: 'doubt' });
    expect(matchStudent('Ким', roster).candidates.sort()).toEqual(['c', 'd']);
    // The initial tells the two Kims apart only when it differs: "Д." does not.
    expect(matchStudent('Ким Д.', roster).status).toBe('doubt');
  });

  it('knows nobody it cannot place', () => {
    expect(matchStudent('Петров Сергей', roster)).toEqual({
      studentId: null,
      status: 'none',
      candidates: [],
    });
  });
});

describe('a cell and a header', () => {
  it('reads grades and absences, and ignores the rest', () => {
    expect(readGradeCell('5')).toEqual({ value: 5, absent: false });
    expect(readGradeCell('4.0')).toEqual({ value: 4, absent: false });
    expect(readGradeCell('н')).toEqual({ value: null, absent: true });
    expect(readGradeCell('Н/Б')).toEqual({ value: null, absent: true });
    expect(readGradeCell('yo‘q')).toEqual({ value: null, absent: true });
    expect(readGradeCell('1')).toBeNull();
    expect(readGradeCell('5/4')).toBeNull();
    expect(readGradeCell('')).toBeNull();
  });

  it('takes a date out of a header', () => {
    const today = new Date(Date.UTC(2026, 10, 21));
    expect(headerDate('05.11', today)).toBe('2026-11-05');
    expect(headerDate('15.01.2027', today)).toBe('2027-01-15');
    expect(headerDate('Контрольная', today)).toBeNull();
    expect(headerDate('3', today)).toBeNull();
  });
});
