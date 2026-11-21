import { loadXlsx, formatKind } from './xlsx.js';
import { attr, child, children, descendants, parseXml, textContent, type Element } from './xml.js';
import { FileProblem, openOffice } from './zip.js';

/**
 * Tables out of an Excel or Word file (PLAN.md 5.2, 5.5; stage 4, W10): a KTP or a sheet of grades
 * as rows of text, the way the teacher sees them. The importer maps the columns afterwards.
 *
 * Excel: every sheet; a number shown as a date in Excel becomes `dd.mm.yyyy`. Word: every table of
 * the document; a merged cell keeps its text in its first column.
 */

export interface ReadTable {
  /** The sheet's name, or "Таблица N" for a Word table. */
  name: string;
  rows: string[][];
}

/** A KTP is a few hundred rows; anything bigger is cut, not refused. */
const MAX_ROWS = 600;
const MAX_COLS = 30;

/** "C12" → [row 11, col 2]. */
function position(ref: string): [number, number] | null {
  const m = /^([A-Z]{1,3})([0-9]{1,7})$/.exec(ref);
  if (!m?.[1] || !m[2]) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

/** Excel's day number as a date: 1900 system, with its famous false 29 February. */
function excelDate(serial: number): string {
  const days = Math.floor(serial);
  const ms = Date.UTC(1899, 11, 30) + days * 86_400_000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** Built-in Excel formats that show dates (14–22, 45–47 time aside). */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22]);

function fromXlsx(bytes: Uint8Array): ReadTable[] {
  const m = loadXlsx(bytes);
  const isDate = (style: number): boolean => {
    const id = m.xfs[style]?.numFmtId ?? 0;
    if (DATE_FORMAT_IDS.has(id)) return true;
    const code = m.numFmts.get(id);
    return code !== undefined && formatKind(code) === 'date';
  };
  return m.sheets.map((sheet) => {
    const grid: string[][] = [];
    for (const [ref, cell] of sheet.cells) {
      const at = position(ref);
      if (!at || at[0] >= MAX_ROWS || at[1] >= MAX_COLS || cell.value === null) continue;
      let text = cell.value;
      if (cell.type === 'n' && isDate(cell.style) && text.trim() && !Number.isNaN(Number(text))) {
        text = excelDate(Number(text));
      } else if (cell.type === 'n' && /^-?\d+\.\d{6,}$/.test(text)) {
        // A float Excel stored with all its digits: "2.0000000001" is shown as 2.
        text = String(Math.round(Number(text) * 1e6) / 1e6);
      }
      const row = (grid[at[0]] ??= []);
      row[at[1]] = text.trim();
    }
    return { name: sheet.name, rows: tidy(grid) };
  });
}

function cellText(tc: Element): string {
  return descendants(tc, 'p')
    .map((p) => descendants(p, 't').map(textContent).join(''))
    .filter((s) => s.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fromDocx(bytes: Uint8Array): ReadTable[] {
  const parts = openOffice(bytes, (n) => n === 'word/document.xml');
  const doc = parseXml(parts.get('word/document.xml') ?? '<document/>');
  // Only the outermost tables: a table inside a cell belongs to that cell's text.
  const tables = descendants(doc, 'tbl').filter((t) => {
    for (let p = t.parent; p; p = p.parent) {
      if ('name' in p && /(^|:)tbl$/.test(p.name)) return false;
    }
    return true;
  });
  return tables.map((tbl, i) => {
    const rows: string[][] = [];
    for (const tr of children(tbl, 'tr').slice(0, MAX_ROWS)) {
      const row: string[] = [];
      for (const tc of children(tr, 'tc')) {
        const span = Number(attr(child(child(tc, 'tcPr'), 'gridSpan'), 'val') ?? 1);
        row.push(cellText(tc));
        // A merged cell takes several columns: the others stay empty, so columns keep their places.
        for (let k = 1; k < Math.min(span, MAX_COLS); k += 1) row.push('');
      }
      rows.push(row.slice(0, MAX_COLS));
    }
    return { name: `Таблица ${i + 1}`, rows: tidy(rows) };
  });
}

/** Holes filled with "", empty rows dropped, every row as wide as the widest. */
function tidy(grid: (string[] | undefined)[]): string[][] {
  const rows = grid
    .map((r) => Array.from({ length: r?.length ?? 0 }, (_, i) => r?.[i] ?? ''))
    .filter((r) => r.some((c) => c !== ''));
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
}

/** Tables of an .xlsx or .docx; an old .xls/.doc or a password is a `FileProblem`, as for checks. */
export function readTables(bytes: Uint8Array, fileName: string): ReadTable[] {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'xlsx') return fromXlsx(bytes);
  if (ext === 'docx') return fromDocx(bytes);
  throw new FileProblem('unreadable');
}
