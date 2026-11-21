import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CriterionSchema,
  PracticeTaskSchema,
  type CheckReport,
  type Criterion,
  type PracticeCheck,
} from '@sinf/shared';
import { checkFile, formatKind } from '../src/index.js';

/**
 * PLAN.md 3.6: every checker on reference files "right / wrong" (CLAUDE.md §9.6), made by
 * tools/fixtures/make_checker_fixtures.py, including what real Office programs write.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const file = (path: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, path)));

/** A task's criteria from checks, one point each. */
function criteria(checks: Record<string, unknown>): Criterion[] {
  return Object.entries(checks).map(([id, check]) =>
    CriterionSchema.parse({ id, kind: 'auto', label: { ru: id, uz: id }, points: 1, check }),
  );
}

const outcomes = (report: CheckReport): Record<string, string> =>
  Object.fromEntries(report.results.map((r) => [r.id, r.outcome]));

function expectAll(report: CheckReport, outcome: string): void {
  const wrong = report.results.filter((r) => r.outcome !== outcome);
  expect(wrong, JSON.stringify(wrong, null, 1)).toEqual([]);
}

// ---------- docx

const DOCX = criteria({
  h1: { type: 'docx.headings', level: 1 },
  h2: { type: 'docx.headings', level: 2 },
  font: { type: 'docx.font', family: 'Times New Roman', sizePt: 14 },
  table: { type: 'docx.table', minRows: 3, minCols: 2 },
  image: { type: 'docx.image' },
  list: { type: 'docx.list', minItems: 3 },
  text: { type: 'docx.text', contains: 'шестьсот   учеников' },
  paragraphs: { type: 'docx.paragraphs', min: 6 },
  align: { type: 'docx.align', align: 'both' },
  bold: { type: 'docx.bold', text: 'важно' },
  spacing: { type: 'docx.lineSpacing', value: 1.5 },
});

describe('docx', () => {
  it('passes a document done right, on every criterion', () => {
    const report = checkFile(file('docx/good.docx'), 'Сочинение.docx', DOCX);
    expect(report.file).toBe('ok');
    expectAll(report, 'pass');
    expect(report.autoScore).toBe(DOCX.length);
    expect(report.autoMax).toBe(DOCX.length);
  });

  it('fails a document done wrong, on every criterion', () => {
    const report = checkFile(file('docx/bad.docx'), 'Сочинение.docx', DOCX);
    expectAll(report, 'fail');
    expect(report.autoScore).toBe(0);
    // The teacher sees what was found, not only "no".
    expect(report.results.find((r) => r.id === 'font')?.found).toContain('Calibri 11 пт');
  });

  it('reads a Russian Word: its own style ids, split words, theme fonts, sizes from the defaults', () => {
    const report = checkFile(file('docx/russian-word.docx'), 'Сочинение.docx', DOCX);
    expectAll(report, 'pass');
    // Deleted text is not text.
    const deleted = checkFile(
      file('docx/russian-word.docx'),
      'x.docx',
      criteria({ t: { type: 'docx.text', contains: 'лишнее' } }),
    );
    expect(outcomes(deleted)).toEqual({ t: 'fail' });
  });

  it('does not fail a child for an old or protected file, or a file that is not one', () => {
    const old = checkFile(file('docx/protected.docx'), 'Сочинение.docx', DOCX);
    expect(old.file).toBe('old_or_protected');
    expectAll(old, 'unknown');
    const fake = checkFile(file('docx/renamed-text.docx'), 'Сочинение.docx', DOCX);
    expect(fake.file).toBe('unreadable');
    expectAll(fake, 'unknown');
  });
});

// ---------- xlsx

const XLSX = criteria({
  sum: { type: 'xlsx.formula', cell: 'B5', function: 'SUM' },
  total: { type: 'xlsx.value', cell: 'B5', equals: 50 },
  filledDown: { type: 'xlsx.formula', cell: '$C$4' },
  twice: { type: 'xlsx.value', cell: 'C4', equals: 50, sheet: 'расходы' },
  formulas: { type: 'xlsx.formulas', min: 4 },
  percent: { type: 'xlsx.numberFormat', cell: 'D2', kind: 'percent' },
  date: { type: 'xlsx.numberFormat', cell: 'E2', kind: 'date' },
  decimal: { type: 'xlsx.numberFormat', cell: 'B2', kind: 'decimal' },
  bold: { type: 'xlsx.bold', cell: 'A1' },
  fill: { type: 'xlsx.fill', cell: 'A1' },
  border: { type: 'xlsx.border', cell: 'A1' },
  chart: { type: 'xlsx.chart', kind: 'bar' },
  sheets: { type: 'xlsx.sheets', min: 2 },
  filled: { type: 'xlsx.filled', min: 15 },
  heading: { type: 'xlsx.value', cell: 'A1', equals: 'покупка' },
});

describe('xlsx', () => {
  it('passes a table done right: formulas filled down, cached values, styles, a chart', () => {
    expectAll(checkFile(file('xlsx/good.xlsx'), 'Расходы.xlsx', XLSX), 'pass');
  });

  it('fails a table typed in by hand', () => {
    const report = checkFile(file('xlsx/bad.xlsx'), 'Расходы.xlsx', XLSX);
    const { heading, ...rest } = outcomes(report);
    expect(heading).toBe('pass');
    expect(Object.values(rest).every((o) => o === 'fail')).toBe(true);
    expect(report.results.find((r) => r.id === 'total')?.found).toBe('в B5: 60');
  });

  it('cannot tell the value of a formula nobody calculated, and says so', () => {
    const report = checkFile(file('xlsx/no-cache.xlsx'), 'Расходы.xlsx', XLSX);
    expect(outcomes(report)['total']).toBe('unknown');
    expect(outcomes(report)['sum']).toBe('pass');
  });

  it('reads what a number format means', () => {
    expect(formatKind('0%')).toBe('percent');
    expect(formatKind('0.00%')).toBe('percent');
    expect(formatKind('dd.mm.yyyy')).toBe('date');
    expect(formatKind('[$-419]d mmmm yyyy;@')).toBe('date');
    expect(formatKind('#,##0.00 "сўм"')).toBe('currency');
    expect(formatKind('#,##0.00\\ [$₽-419]')).toBe('currency');
    expect(formatKind('0.0')).toBe('decimal');
    expect(formatKind('#,##0')).toBe('integer');
    expect(formatKind('@')).toBe('other');
  });
});

// ---------- pptx

const PPTX = criteria({
  slides: { type: 'pptx.slides', min: 4 },
  titles: { type: 'pptx.titles' },
  image: { type: 'pptx.image' },
  text: { type: 'pptx.text', contains: 'пятнадцать компьютеров' },
  layouts: { type: 'pptx.layouts', min: 3 },
  transitions: { type: 'pptx.transitions', min: 2 },
  notes: { type: 'pptx.notes' },
  table: { type: 'pptx.table' },
  chart: { type: 'pptx.chart' },
});

describe('pptx', () => {
  it('passes a presentation done right', () => {
    expectAll(checkFile(file('pptx/good.pptx'), 'Школа.pptx', PPTX), 'pass');
  });

  it('fails a presentation of one empty slide', () => {
    expectAll(checkFile(file('pptx/bad.pptx'), 'Школа.pptx', PPTX), 'fail');
  });

  it('takes the order of slides from the presentation, not from file names', () => {
    const first = criteria({ t: { type: 'pptx.titles', slide: 1 } });
    expect(checkFile(file('pptx/good.pptx'), 'a.pptx', first).results[0]?.found).toBe(
      'заголовок: «Моя школа»',
    );
    expect(checkFile(file('pptx/reordered.pptx'), 'a.pptx', first).results[0]?.found).toBe(
      'заголовок: «Расписание»',
    );
  });
});

// ---------- html and css

const HTML = criteria({
  h1: { type: 'html.tag', tag: 'h1' },
  lang: { type: 'html.attr', tag: 'html', attr: 'lang', value: 'ru' },
  title: { type: 'html.title', contains: 'школа' },
  links: { type: 'html.links' },
  images: { type: 'html.images', alt: true },
  table: { type: 'html.table', minRows: 3, minCols: 2 },
  list: { type: 'html.list', minItems: 3 },
  wellFormed: { type: 'html.wellFormed' },
  color: { type: 'css.property', selector: 'h1', property: 'color', value: 'navy' },
  inline: { type: 'css.property', property: 'color', value: 'green' },
  linked: { type: 'css.linked' },
});

describe('html and css', () => {
  it('passes a page done right', () => {
    expectAll(checkFile(file('html/good.html'), 'index.html', HTML), 'pass');
  });

  it('fails a page done wrong, and names the tags left open', () => {
    const report = checkFile(file('html/bad.html'), 'index.html', HTML);
    expectAll(report, 'fail');
    const found = report.results.find((r) => r.id === 'wellFormed')?.found ?? '';
    expect(found).toContain('нет <!DOCTYPE html>');
    expect(found).toContain('не закрыт <h2>');
  });

  it('reads a stylesheet, inside @media too, and refuses page checks on it', () => {
    const report = checkFile(
      file('html/style.css'),
      'style.css',
      criteria({
        body: { type: 'css.property', selector: 'body', property: 'background' },
        media: { type: 'css.property', selector: 'table', property: 'width', value: '100%' },
        font: { type: 'css.property', property: 'font-family', value: 'Arial, sans-serif' },
        page: { type: 'html.tag', tag: 'h1' },
        text: { type: 'txt.contains', text: 'оформление сайта' },
      }),
    );
    expect(outcomes(report)).toEqual({
      body: 'pass',
      media: 'pass',
      font: 'pass',
      page: 'unknown',
      text: 'pass',
    });
  });
});

// ---------- txt

const TXT = criteria({
  notEmpty: { type: 'txt.notEmpty' },
  contains: { type: 'txt.contains', text: 'шестьсот' },
  notContains: { type: 'txt.notContains', text: 'TODO' },
  lines: { type: 'txt.lines', min: 4 },
  words: { type: 'txt.words', min: 12 },
  chars: { type: 'txt.chars', min: 60 },
  matches: { type: 'txt.matches', pattern: '^Моя школа', flags: '' },
  startsWith: { type: 'txt.startsWith', text: 'Моя', caseSensitive: true },
  endsWith: { type: 'txt.endsWith', text: 'конец.' },
});

describe('txt', () => {
  it.each(['txt/good.txt', 'txt/good-1251.txt', 'txt/good-utf16.txt'])(
    'passes a text done right in any of Notepad’s encodings: %s',
    (path) => {
      expectAll(checkFile(file(path), 'Текст.txt', TXT), 'pass');
    },
  );

  it('fails a text that is not there yet', () => {
    const report = checkFile(file('txt/bad.txt'), 'Текст.txt', TXT);
    expect(outcomes(report)).toEqual({
      notEmpty: 'pass',
      contains: 'fail',
      notContains: 'pass',
      lines: 'fail',
      words: 'fail',
      chars: 'fail',
      matches: 'fail',
      startsWith: 'fail',
      endsWith: 'fail',
    });
  });

  it('says "cannot tell" for a broken pattern in the task, not "wrong"', () => {
    const bad = criteria({ re: { type: 'txt.matches', pattern: '(' } });
    expect(outcomes(checkFile(file('txt/good.txt'), 'a.txt', bad))).toEqual({ re: 'unknown' });
  });
});

// ---------- the contract

describe('a task', () => {
  it('is data: a whole practice task parses, and nonsense does not', () => {
    const task = PracticeTaskSchema.parse({
      app: 'word',
      fileName: 'Документ.docx',
      criteria: [
        ...DOCX.slice(0, 5),
        { id: 'neat', kind: 'manual', label: { ru: 'Аккуратно', uz: 'Toza' }, points: 2 },
      ],
    });
    expect(task.template).toBeNull();
    expect(task.showChecklist).toBe(true);
    expect(() =>
      PracticeTaskSchema.parse({ ...task, criteria: [...task.criteria, task.criteria[0]] }),
    ).toThrow();
    expect(() =>
      CriterionSchema.parse({
        id: 'x',
        kind: 'auto',
        label: { ru: 'x', uz: 'x' },
        points: 1,
        check: { type: 'docx.magic' },
      }),
    ).toThrow();
  });

  it('counts only the automatic criteria, and only those that passed', () => {
    const mixed: Criterion[] = [
      ...criteria({
        a: { type: 'txt.contains', text: 'школа', caseSensitive: false } satisfies PracticeCheck,
      }),
      {
        id: 'b',
        kind: 'auto',
        label: { ru: 'b', uz: 'b' },
        points: 3,
        check: { type: 'txt.contains', text: 'нет такого', caseSensitive: false },
      },
      { id: 'c', kind: 'manual', label: { ru: 'c', uz: 'c' }, points: 5 },
    ];
    const report = checkFile(file('txt/good.txt'), 'a.txt', mixed);
    expect(report.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect({ score: report.autoScore, max: report.autoMax }).toEqual({ score: 1, max: 4 });
  });

  it('does not check a file of the wrong kind', () => {
    const report = checkFile(file('txt/good.txt'), 'Рисунок.png', TXT);
    expect(report.file).toBe('wrong_type');
    expectAll(report, 'unknown');
    const mismatch = checkFile(file('txt/good.txt'), 'a.txt', DOCX.slice(0, 1));
    expectAll(mismatch, 'unknown');
  });

  it('checks a file in well under a second', () => {
    // PLAN.md 3.6: under 1 s on a 4× slower processor — so under 250 ms here, with room.
    for (const [path, name, task] of [
      ['docx/good.docx', 'a.docx', DOCX],
      ['xlsx/good.xlsx', 'a.xlsx', XLSX],
      ['pptx/good.pptx', 'a.pptx', PPTX],
      ['html/good.html', 'a.html', HTML],
    ] as const) {
      const bytes = file(path);
      checkFile(bytes, name, task);
      const started = performance.now();
      checkFile(bytes, name, task);
      expect(performance.now() - started, path).toBeLessThan(250);
    }
  });
});
