import type { PracticeCheck } from '@sinf/shared';
import { parseRels } from './rels.js';
import { unknown, verdict, type Verdict } from './verdict.js';
import {
  attr,
  child,
  children,
  descendants,
  first,
  fold,
  onOff,
  parseXml,
  relId,
  textContent,
} from './xml.js';
import { openOffice, relationships } from './zip.js';

/**
 * Excel workbooks (.xlsx). What a real Excel writes:
 * - formulas in English with commas, without "=": `SUM(B2:B4)` even in a Russian Excel ("СУММ");
 * - a formula filled down is stored once ("shared") and only referenced in the other cells;
 * - the value Excel last calculated is kept next to the formula — openpyxl does not keep one, so a
 *   value check of such a file is "cannot tell", not "wrong";
 * - a cell's look is an index into a table of styles (`cellXfs`), which points to fonts, fills,
 *   borders and number formats;
 * - the order of sheets is the workbook's, not the order of file names.
 */

type XlsxCheck = Extract<PracticeCheck, { type: `xlsx.${string}` }>;

interface Cell {
  value: string | null;
  type: string;
  formula: string | null;
  style: number;
}

interface Sheet {
  name: string;
  cells: Map<string, Cell>;
}

interface Xf {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
}

export interface XlsxModel {
  sheets: Sheet[];
  xfs: Xf[];
  numFmts: Map<number, string>;
  boldFonts: Set<number>;
  solidFills: Set<number>;
  borders: Set<number>;
  charts: string[];
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return descendants(parseXml(xml), 'si').map((si) =>
    // Rich text keeps its pieces in runs; plain text in one <t>. Phonetic hints are not text.
    descendants(si, 't')
      .filter((t) => !t.parent || !('name' in t.parent) || !/(^|:)rPh$/.test(t.parent.name))
      .map(textContent)
      .join(''),
  );
}

export function loadXlsx(bytes: Uint8Array): XlsxModel {
  const parts = openOffice(
    bytes,
    (n) =>
      n === 'xl/workbook.xml' ||
      n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/sharedStrings.xml' ||
      n === 'xl/styles.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(n) ||
      /^xl\/charts\/chart[0-9]+\.xml$/.test(n),
  );
  const strings = sharedStrings(parts.get('xl/sharedStrings.xml'));
  const workbook = parseXml(parts.get('xl/workbook.xml') ?? '<workbook/>');
  const rels = relationships(parts, 'xl/workbook.xml', parseRels);

  const sheets: Sheet[] = [];
  for (const s of descendants(workbook, 'sheet')) {
    const target = rels.get(relId(s) ?? '')?.target;
    const xml = target ? parts.get(target) : undefined;
    if (!xml) continue;
    const cells = new Map<string, Cell>();
    const shared = new Map<string, string>();
    for (const c of descendants(parseXml(xml), 'c')) {
      const ref = attr(c, 'r');
      if (!ref) continue;
      const type = attr(c, 't') ?? 'n';
      const f = child(c, 'f');
      let formula: string | null = null;
      if (f) {
        const text = textContent(f).trim();
        const si = attr(f, 'si');
        if (attr(f, 't') === 'shared' && si !== undefined) {
          if (text) shared.set(si, text);
          formula = text || shared.get(si) || '(общая формула)';
        } else {
          formula = text || null;
        }
      }
      const v = child(c, 'v');
      // An empty <v/> is what a program that does not calculate leaves: no value.
      let value: string | null = v && textContent(v) !== '' ? textContent(v) : null;
      if (type === 's' && value !== null) value = strings[Number(value)] ?? null;
      if (type === 'inlineStr') value = textContent(child(c, 'is'));
      cells.set(ref.toUpperCase(), { value, type, formula, style: Number(attr(c, 's') ?? 0) });
    }
    sheets.push({ name: attr(s, 'name') ?? '', cells });
  }

  const styles = parseXml(parts.get('xl/styles.xml') ?? '<styleSheet/>');
  const numFmts = new Map<number, string>();
  for (const nf of descendants(styles, 'numFmt')) {
    numFmts.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode') ?? '');
  }
  const xfs = children(first(styles, 'cellXfs'), 'xf').map((xf) => ({
    numFmtId: Number(attr(xf, 'numFmtId') ?? 0),
    fontId: Number(attr(xf, 'fontId') ?? 0),
    fillId: Number(attr(xf, 'fillId') ?? 0),
    borderId: Number(attr(xf, 'borderId') ?? 0),
  }));
  const boldFonts = new Set<number>();
  children(first(styles, 'fonts'), 'font').forEach((font, i) => {
    if (onOff(child(font, 'b'))) boldFonts.add(i);
  });
  const solidFills = new Set<number>();
  children(first(styles, 'fills'), 'fill').forEach((fill, i) => {
    const pattern = child(fill, 'patternFill');
    const type = attr(pattern, 'patternType');
    // Fills 0 and 1 are Excel's own "none" and "gray125"; a gradient is a fill too.
    if ((type && type !== 'none' && type !== 'gray125') || child(fill, 'gradientFill'))
      solidFills.add(i);
  });
  const borders = new Set<number>();
  children(first(styles, 'borders'), 'border').forEach((border, i) => {
    if (
      ['left', 'right', 'top', 'bottom', 'start', 'end'].some((side) => {
        const style = attr(child(border, side), 'style');
        return style !== undefined && style !== 'none';
      })
    ) {
      borders.add(i);
    }
  });

  const charts = parts
    .names()
    .filter((n) => /^xl\/charts\/chart[0-9]+\.xml$/.test(n))
    .map((n) => parts.get(n) ?? '');

  return { sheets, xfs, numFmts, boldFonts, solidFills, borders, charts };
}

const BUILTIN_KIND: Record<number, string> = {
  1: 'integer',
  2: 'decimal',
  3: 'integer',
  4: 'decimal',
  5: 'currency',
  6: 'currency',
  7: 'currency',
  8: 'currency',
  9: 'percent',
  10: 'percent',
  14: 'date',
  15: 'date',
  16: 'date',
  17: 'date',
  22: 'date',
  37: 'currency',
  38: 'currency',
  39: 'currency',
  40: 'currency',
  44: 'currency',
};

/** What a number format means for a child's table, from its code. */
export function formatKind(code: string): string {
  const plain = code.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  if (plain.includes('%')) return 'percent';
  // "[$₽-419]" names a currency; "[$-419]" only a language.
  if (/\[\$[^-\]]+|[₽$€£¥]|сўм|so['’]m|руб|сум/i.test(code.replace(/\[\$-[^\]]*\]/g, ''))) {
    return 'currency';
  }
  if (/[dyдгм]/i.test(plain.replace(/\[[^\]]*\]/g, '')) && !/^[#0.,\s]+$/.test(plain))
    return 'date';
  if (/0[.,]0/.test(plain)) return 'decimal';
  if (/^[#0,\s]+$/.test(plain.split(';')[0] ?? '')) return 'integer';
  return 'other';
}

const CHART_KIND: Record<string, string> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'pie',
  ofPieChart: 'pie',
  areaChart: 'area',
  area3DChart: 'area',
  scatterChart: 'scatter',
  bubbleChart: 'scatter',
};

export function runXlsx(m: XlsxModel, check: XlsxCheck): Verdict {
  const sheetOf = (name: string | undefined): Sheet | undefined =>
    name === undefined ? m.sheets[0] : m.sheets.find((s) => fold(s.name) === fold(name));

  switch (check.type) {
    case 'xlsx.sheets':
      return verdict(m.sheets.length >= check.min, `листов: ${m.sheets.length}`);
    case 'xlsx.chart': {
      const kinds = m.charts.flatMap((xml) =>
        Object.entries(CHART_KIND)
          .filter(
            ([tag]) =>
              xml.includes(`:${tag}>`) || xml.includes(`:${tag} `) || xml.includes(`<${tag}`),
          )
          .map(([, kind]) => kind),
      );
      const n =
        check.kind === 'any' ? m.charts.length : kinds.filter((k) => k === check.kind).length;
      return verdict(n >= check.min, `диаграмм: ${m.charts.length}`);
    }
  }

  const sheet = sheetOf(check.sheet);
  if (!sheet) return verdict(false, check.sheet ? `нет листа «${check.sheet}»` : 'нет листов');

  switch (check.type) {
    case 'xlsx.formulas': {
      const n = [...sheet.cells.values()].filter((c) => c.formula).length;
      return verdict(n >= check.min, `формул: ${n}`);
    }
    case 'xlsx.filled': {
      const n = [...sheet.cells.values()].filter(
        (c) => c.formula || (c.value !== null && c.value.trim() !== ''),
      ).length;
      return verdict(n >= check.min, `заполнено ячеек: ${n}`);
    }
  }

  const cell = sheet.cells.get(check.cell);
  const xf = m.xfs[cell?.style ?? 0];
  switch (check.type) {
    case 'xlsx.value': {
      if (!cell) return verdict(false, `${check.cell} пустая`);
      if (cell.value === null) {
        return cell.formula
          ? unknown(`в ${check.cell} формула, но её значение не сохранено`)
          : verdict(false, `${check.cell} пустая`);
      }
      if (typeof check.equals === 'number') {
        const n = Number(cell.value);
        return verdict(
          Number.isFinite(n) && Math.abs(n - check.equals) <= check.tolerance,
          `в ${check.cell}: ${cell.value}`,
        );
      }
      return verdict(fold(cell.value) === fold(check.equals), `в ${check.cell}: ${cell.value}`);
    }
    case 'xlsx.formula': {
      if (!cell?.formula) return verdict(false, `в ${check.cell} нет формулы`);
      const fn = check.function;
      const ok =
        !fn ||
        new RegExp(`(^|[^A-Z_.])(_xlfn\\.)?${fn.replace('.', '\\.')}\\s*\\(`, 'i').test(
          cell.formula,
        );
      return verdict(ok, `в ${check.cell}: =${cell.formula}`);
    }
    case 'xlsx.numberFormat': {
      if (!xf) return verdict(false, `у ${check.cell} обычный формат`);
      const code = m.numFmts.get(xf.numFmtId);
      const kind = code !== undefined ? formatKind(code) : (BUILTIN_KIND[xf.numFmtId] ?? 'other');
      return verdict(
        kind === check.kind,
        `формат ${check.cell}: ${code ?? `встроенный №${xf.numFmtId}`}`,
      );
    }
    case 'xlsx.bold':
      return verdict(!!xf && m.boldFonts.has(xf.fontId), null);
    case 'xlsx.fill':
      return verdict(!!xf && m.solidFills.has(xf.fillId), null);
    case 'xlsx.border':
      return verdict(!!xf && m.borders.has(xf.borderId), null);
  }
}
