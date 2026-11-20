import { strToU8, zipSync } from 'fflate';

/**
 * The smallest spreadsheet Excel opens without complaint (S1.13): one sheet, text and numbers,
 * bold and centred cells, column widths and frozen headers. No shared strings — text goes inline —
 * and no library beyond the zip (docs/stage1-architecture.md §1: exceljs is not worth its weight
 * for one sheet).
 */

/** `muted` is grey and wraps: lesson topics under the dates. */
export type CellStyle = 'bold' | 'center' | 'boldCenter' | 'muted';
export type CellValue = string | number | null;
export type Cell = CellValue | { value: CellValue; style?: CellStyle };

export interface SheetSpec {
  name: string;
  rows: Cell[][];
  /** Widths in characters, from column A on. */
  widths?: number[];
  /** Rows on top and columns on the left that stay in place while scrolling. */
  freeze?: { rows: number; cols: number };
}

/** Style ids as laid out in `styles.xml` below. */
const STYLE_ID: Record<CellStyle, number> = { bold: 1, center: 2, boldCenter: 3, muted: 4 };

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** `A`, `B`, … `Z`, `AA`, … for a zero-based column. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** Text safe inside XML: escaped, and without the control characters XML 1.0 forbids outright. */
export function xmlText(text: string): string {
  return text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Excel refuses a sheet name over 31 characters or with any of `[]:*?/\`. */
export function sheetName(name: string): string {
  const clean = name
    .replace(/[[\]:*?/\\]/g, ' ')
    .trim()
    .slice(0, 31)
    .trim();
  return clean || 'Sheet1';
}

function cellXml(cell: Cell, ref: string): string {
  const { value, style } =
    cell !== null && typeof cell === 'object' ? cell : { value: cell, style: undefined };
  const s = style ? ` s="${STYLE_ID[style]}"` : '';
  if (value === null || value === '') return style ? `<c r="${ref}"${s}/>` : '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : '';
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function sheetXml(spec: SheetSpec): string {
  const freeze = spec.freeze && spec.freeze.rows > 0 && spec.freeze.cols > 0 ? spec.freeze : null;
  const views = freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${freeze.cols}" ySplit="${freeze.rows}" topLeftCell="${columnName(freeze.cols)}${freeze.rows + 1}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols =
    spec.widths && spec.widths.length > 0
      ? `<cols>${spec.widths
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
          .join('')}</cols>`
      : '';
  const rows = spec.rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

const STYLES = `${HEAD}<styleSheet xmlns="${MAIN}">\
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>\
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>\
<font><sz val="11"/><color rgb="FF808080"/><name val="Calibri"/><family val="2"/></font></fonts>\
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>\
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>\
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>\
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>\
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>\
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\
</styleSheet>`;

/** A one-sheet `.xlsx` file. */
export function buildXlsx(spec: SheetSpec): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
<Default Extension="xml" ContentType="application/xml"/>\
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\
</Types>`,
    '_rels/.rels': `${HEAD}<Relationships xmlns="${PKG_REL}">\
<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>\
</Relationships>`,
    'xl/workbook.xml': `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}">\
<sheets><sheet name="${xmlText(sheetName(spec.name))}" sheetId="1" r:id="rId1"/></sheets>\
</workbook>`,
    'xl/_rels/workbook.xml.rels': `${HEAD}<Relationships xmlns="${PKG_REL}">\
<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>\
<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>\
</Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': sheetXml(spec),
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])),
    { level: 6 },
  );
}

/** The MIME type browsers and Excel expect for `.xlsx`. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
