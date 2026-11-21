import { describe, expect, it } from 'vitest';
import {
  guessKtpMapping,
  ktpChangesOver,
  ktpDueDate,
  ktpPlanned,
  mapKtpRows,
  suggestLesson,
} from '../src/index.js';

/** W10: the column wizard of the KTP import. */

const excel = [
  ['Календарно-тематический план. Информатика, 5 класс', '', '', '', '', ''],
  ['№', 'Тема урока', 'Кол-во часов', 'Неделя', 'Дата', 'Примечание'],
  ['1', 'Техника безопасности', '1', '1', '03.09.2026', ''],
  ['I четверть', '', '', '', '', ''],
  ['2', 'Клавиатура', 'один', '1', '05.09.2026', 'практика'],
  ['3', '', '', '', '', ''],
];

describe('the column wizard', () => {
  it('finds the header under a title row, and each column by its words', () => {
    expect(guessKtpMapping(excel)).toEqual({
      header: 1,
      mapping: { number: 0, topic: 1, hours: 2, weekOrDate: 4, note: 5 },
    });
    expect(guessKtpMapping([['T/r', 'Mavzu', 'Soat', 'Sana', 'Izoh']]).mapping).toEqual({
      number: 0,
      topic: 1,
      hours: 2,
      weekOrDate: 3,
      note: 4,
    });
  });

  it('turns rows into KTP rows, skipping sections and empty topics, keeping odd hours visible', () => {
    const { header, mapping } = guessKtpMapping(excel);
    const preview = mapKtpRows(excel, header, mapping);
    expect(preview.map((p) => [p.line, p.problem, p.row?.topic ?? null])).toEqual([
      [3, null, 'Техника безопасности'],
      [4, 'section', null],
      [5, 'bad_hours', 'Клавиатура'],
      [6, 'no_topic', null],
    ]);
    expect(preview[2]?.row).toMatchObject({
      hours: null,
      note: 'практика',
      weekOrDate: '05.09.2026',
    });
  });

  it('without any header, takes the widest column as the topic', () => {
    const rows = [
      ['1', 'Компьютер и его устройства: мышь'],
      ['2', 'Клавиатура'],
    ];
    const guess = guessKtpMapping(rows);
    expect(guess.header).toBe(-1);
    expect(guess.mapping.topic).toBe(1);
    expect(mapKtpRows(rows, guess.header, guess.mapping)).toHaveLength(2);
  });
});

describe('where the class is by the plan', () => {
  const today = new Date(Date.UTC(2026, 9, 1)); // 1 October 2026

  it('reads dates with and without a year, and week numbers from 1 September', () => {
    expect(ktpDueDate('03.09.2026', today)?.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(ktpDueDate('3.9.26', today)?.toISOString().slice(0, 10)).toBe('2026-09-03');
    // Without a year: autumn of this school year, spring of the next calendar year.
    expect(ktpDueDate('15.01', today)?.toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(ktpDueDate('15.10', today)?.toISOString().slice(0, 10)).toBe('2026-10-15');
    // 1 September 2026 is a Tuesday: the first week starts on Monday 31 August.
    expect(ktpDueDate('1', today)?.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(ktpDueDate('5-я', today)?.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(ktpDueDate('сентябрь', today)).toBeNull();
  });

  it('counts the topics due by today; a row without a date goes with the next', () => {
    const rows = ['03.09', '', '17.09', '01.10', '08.10'].map((weekOrDate) => ({ weekOrDate }));
    expect(ktpPlanned(rows, today)).toBe(4);
    expect(ktpPlanned([{ weekOrDate: '' }], today)).toBeNull();
  });
});

describe('a lesson for a topic', () => {
  const lessons = [
    { id: 'a', title: 'Клавиатура и мышь' },
    { id: 'b', title: 'Текстовый редактор Word' },
    { id: 'c', title: 'Рисуем в Paint' },
  ];

  it('suggests the lesson sharing most words, folding case and endings', () => {
    expect(suggestLesson('Устройства ввода: клавиатура и мышь', lessons)?.id).toBe('a');
    expect(suggestLesson('Текстовый редактор WORD', lessons)?.id).toBe('b');
  });

  it('suggests nothing when little is shared', () => {
    expect(suggestLesson('Техника безопасности', lessons)).toBeNull();
    expect(suggestLesson('Файлы и папки на компьютере', lessons)).toBeNull();
  });

  it('tells when the changes are over what the school allows', () => {
    expect(ktpChangesOver({ base: 10, changed: 3, allowedPercent: 30 })).toBe(false);
    expect(ktpChangesOver({ base: 10, changed: 4, allowedPercent: 30 })).toBe(true);
  });
});
