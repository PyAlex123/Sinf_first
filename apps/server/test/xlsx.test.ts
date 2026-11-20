import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx, columnName, sheetName, xmlText } from '../src/services/xlsx.js';
import { expectWellFormed } from './xml.js';

/**
 * S1.13: the Excel file (docs/stage1-architecture.md §17 — "zip unpacks, XML is correct"). Whether
 * Excel itself opens it is for the author to check; here we check what Excel insists on.
 */

describe('xlsx helpers', () => {
  it('names columns like Excel does', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
    expect(columnName(701)).toBe('ZZ');
    expect(columnName(702)).toBe('AAA');
  });

  it('escapes text and drops characters XML forbids', () => {
    expect(xmlText('a < b & "c" > d')).toBe('a &lt; b &amp; &quot;c&quot; &gt; d');
    expect(xmlText('bad\u0001char\u0008')).toBe('badchar');
    expect(xmlText('Алиев Тимур')).toBe('Алиев Тимур');
  });

  it('keeps sheet names within Excel’s rules', () => {
    expect(sheetName('Журнал 1А')).toBe('Журнал 1А');
    expect(sheetName('a/b:c*d?[e]')).toBe('a b c d  e');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName('???')).toBe('Sheet1');
  });
});

describe('buildXlsx', () => {
  const file = buildXlsx({
    name: 'Журнал 1А',
    rows: [
      [{ value: '№', style: 'bold' }, { value: 'Ученик', style: 'bold' }, '20.11.2026'],
      [1, 'Абдуллаев Жасур', { value: 7, style: 'center' }],
      [2, 'Алиев & <Тимур>', { value: 'н', style: 'center' }],
      [],
      [null, 'Легенда'],
    ],
    widths: [5, 30, 12],
    freeze: { rows: 2, cols: 2 },
  });
  const parts = unzipSync(file);
  const text = (path: string): string => {
    const part = parts[path];
    if (!part) throw new Error(`missing ${path}`);
    return strFromU8(part);
  };

  it('is a zip with every part Excel needs', () => {
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    // A zip starts with "PK\x03\x04".
    expect([...file.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('has well-formed XML in every part', () => {
    for (const path of Object.keys(parts)) expectWellFormed(text(path));
  });

  it('writes numbers as numbers, text inline and escaped, styles by id', () => {
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="A2"><v>1</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>7</v></c>');
    expect(sheet).toContain(
      '<c r="B3" t="inlineStr"><is><t xml:space="preserve">Алиев &amp; &lt;Тимур&gt;</t></is></c>',
    );
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).toContain('<row r="4"></row>');
    expect(sheet).toContain('<c r="B5" t="inlineStr">');
  });

  it('freezes the headers and sets column widths', () => {
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('xSplit="2" ySplit="2" topLeftCell="C3"');
    expect(sheet).toContain('<col min="2" max="2" width="30" customWidth="1"/>');
  });

  it('names the sheet and points the workbook at it', () => {
    expect(text('xl/workbook.xml')).toContain('<sheet name="Журнал 1А" sheetId="1" r:id="rId1"/>');
    expect(text('xl/_rels/workbook.xml.rels')).toContain('Target="worksheets/sheet1.xml"');
  });
});
