import { describe, expect, it } from 'vitest';
import { guessKtpMapping, mapKtpRows } from '../src/index.js';

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
