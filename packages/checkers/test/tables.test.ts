import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileProblem, readTables } from '../src/index.js';

/** W10: tables out of a teacher's KTP in Excel and Word. */

const dir = join(import.meta.dirname, '../../../apps/server/test/fixtures/ktp');
const file = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

describe('reading tables', () => {
  it('reads an Excel KTP: the title row, the header, dates as dates', () => {
    const [sheet] = readTables(file('ktp.xlsx'), 'ktp.xlsx');
    expect(sheet?.name).toBe('КТП 5 класс');
    expect(sheet?.rows[0]?.[0]).toContain('Календарно-тематический план');
    expect(sheet?.rows[1]).toEqual([
      '№',
      'Тема урока',
      'Кол-во часов',
      'Неделя',
      'Дата',
      'Примечание',
    ]);
    expect(sheet?.rows[2]).toEqual([
      '1',
      'Техника безопасности. Что такое компьютер',
      '1',
      '1',
      '03.09.2026',
      '',
    ]);
    expect(sheet?.rows).toHaveLength(10);
  });

  it('reads a Word KTP: a merged quarter row keeps its text in its first column', () => {
    const [table] = readTables(file('ktp.docx'), 'ktp.docx');
    expect(table?.rows[0]).toEqual(['№ п/п', 'Тема', 'Часы', 'Дата', 'Примечание']);
    expect(table?.rows[1]).toEqual(['I четверть', '', '', '', '']);
    expect(table?.rows[2]).toEqual([
      '1',
      'Техника безопасности. Что такое компьютер',
      '1',
      '03.09',
      '',
    ]);
    expect(table?.rows).toHaveLength(10);
  });

  it('refuses what it cannot read, as the checkers do', () => {
    expect(() => readTables(new Uint8Array([1, 2, 3]), 'ktp.xlsx')).toThrow(FileProblem);
    expect(() => readTables(file('ktp.xlsx'), 'ktp.pdf')).toThrow(FileProblem);
  });
});
