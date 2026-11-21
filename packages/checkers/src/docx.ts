import type { PracticeCheck } from '@sinf/shared';
import type { Verdict } from './verdict.js';
import { verdict } from './verdict.js';
import {
  attr,
  child,
  children,
  descendants,
  first,
  fold,
  onOff,
  parseXml,
  textContent,
  type Element,
} from './xml.js';
import { openOffice } from './zip.js';

/**
 * Word documents (.docx). What a real Word writes, and python-docx does not:
 * - the text of one word is split into several runs (spell-check marks, revisions, fields);
 * - formatting comes through a chain: document defaults → style → the style it is based on → the
 *   paragraph → the run;
 * - in a Russian Word the style ids are Russian or numbers ("1", "Заголовок1"), while the style
 *   *name* stays "heading 1" — headings are found by name and by outline level, never by id;
 * - fonts may be named through the theme ("minorHAnsi" → Calibri).
 */

type DocxCheck = Extract<PracticeCheck, { type: `docx.${string}` }>;

interface RunProps {
  sizeHalfPt?: number;
  font?: string;
  bold?: boolean;
}

interface ParaProps {
  align?: string;
  /** In 240ths of a line, for "auto" spacing. */
  line?: number;
  outline?: number;
  numbered?: boolean;
}

interface Style {
  name: string;
  basedOn?: string;
  run: RunProps;
  para: ParaProps;
}

interface Run {
  text: string;
  sizePt: number;
  font: string;
  bold: boolean;
}

interface Paragraph {
  text: string;
  runs: Run[];
  /** 1–9 for a heading, 0 for body text. */
  heading: number;
  align: string;
  lineFactor: number | null;
  numbered: boolean;
  /** Inside a table cell: not part of the running text. */
  inTable: boolean;
}

export interface DocxModel {
  paragraphs: Paragraph[];
  tables: { rows: number; cols: number }[];
  images: number;
}

function runProps(rPr: Element | undefined, theme: Map<string, string>): RunProps {
  if (!rPr) return {};
  const out: RunProps = {};
  const sz = attr(child(rPr, 'sz'), 'val');
  if (sz && Number.isFinite(Number(sz))) out.sizeHalfPt = Number(sz);
  const fonts = child(rPr, 'rFonts');
  if (fonts) {
    // Cyrillic text is "high ANSI" for Word; Latin is "ascii". A theme name is resolved.
    const direct = attr(fonts, 'hAnsi') ?? attr(fonts, 'ascii') ?? attr(fonts, 'cs');
    const themed = attr(fonts, 'hAnsiTheme') ?? attr(fonts, 'asciiTheme');
    const font = direct ?? (themed ? theme.get(themed) : undefined);
    if (font) out.font = font;
  }
  const b = onOff(child(rPr, 'b'));
  if (b !== undefined) out.bold = b;
  return out;
}

const ALIGN: Record<string, string> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'both',
  distribute: 'both',
  justify: 'both',
};

function paraProps(pPr: Element | undefined): ParaProps {
  if (!pPr) return {};
  const out: ParaProps = {};
  const jc = attr(child(pPr, 'jc'), 'val');
  if (jc) out.align = ALIGN[jc] ?? 'left';
  const spacing = child(pPr, 'spacing');
  const line = attr(spacing, 'line');
  const rule = attr(spacing, 'lineRule');
  if (line && (!rule || rule === 'auto')) out.line = Number(line);
  const outline = attr(child(pPr, 'outlineLvl'), 'val');
  if (outline !== undefined && Number(outline) < 9) out.outline = Number(outline) + 1;
  if (child(pPr, 'numPr')) out.numbered = true;
  return out;
}

function themeFonts(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  const doc = parseXml(xml);
  const minor = attr(child(first(doc, 'minorFont'), 'latin'), 'typeface');
  const major = attr(child(first(doc, 'majorFont'), 'latin'), 'typeface');
  for (const key of ['minorHAnsi', 'minorAscii', 'minorBidi', 'minorEastAsia'])
    if (minor) map.set(key, minor);
  for (const key of ['majorHAnsi', 'majorAscii', 'majorBidi', 'majorEastAsia'])
    if (major) map.set(key, major);
  return map;
}

const HEADING = /^heading\s*([1-9])$/i;

export function loadDocx(bytes: Uint8Array): DocxModel {
  const parts = openOffice(bytes, (n) =>
    ['word/document.xml', 'word/styles.xml', 'word/theme/theme1.xml'].includes(n),
  );
  const theme = themeFonts(parts.get('word/theme/theme1.xml'));
  const stylesXml = parts.get('word/styles.xml');
  const styles = new Map<string, Style>();
  let defaultRun: RunProps = { sizeHalfPt: 20, font: 'Times New Roman' };
  let defaultPara: ParaProps = {};
  let defaultParaStyle: string | undefined;
  if (stylesXml) {
    const doc = parseXml(stylesXml);
    const defaults = first(doc, 'docDefaults');
    defaultRun = { ...defaultRun, ...runProps(first(child(defaults, 'rPrDefault'), 'rPr'), theme) };
    defaultPara = paraProps(first(child(defaults, 'pPrDefault'), 'pPr'));
    for (const s of descendants(doc, 'style')) {
      const id = attr(s, 'styleId');
      if (!id) continue;
      if (attr(s, 'type') === 'paragraph' && attr(s, 'default') === '1') defaultParaStyle = id;
      styles.set(id, {
        name: attr(child(s, 'name'), 'val') ?? id,
        ...(attr(child(s, 'basedOn'), 'val')
          ? { basedOn: attr(child(s, 'basedOn'), 'val') as string }
          : {}),
        run: runProps(child(s, 'rPr'), theme),
        para: paraProps(child(s, 'pPr')),
      });
    }
  }

  /** A style with everything it inherits, nearest first; stops at loops. */
  const chain = (id: string | undefined): Style[] => {
    const out: Style[] = [];
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const s = styles.get(cur);
      if (!s) break;
      out.push(s);
      cur = s.basedOn;
    }
    return out;
  };
  const pick = <T>(layers: (T | undefined)[]): T | undefined => layers.find((v) => v !== undefined);

  const docXml = parts.get('word/document.xml');
  if (!docXml) throw new Error('no document part');
  const doc = parseXml(docXml);
  const body = first(doc, 'body');

  const paragraphs: Paragraph[] = [];
  for (const p of descendants(body, 'p')) {
    const pPr = child(p, 'pPr');
    const own = paraProps(pPr);
    const styleId = attr(child(pPr, 'pStyle'), 'val') ?? defaultParaStyle;
    const styleChain = chain(styleId);
    const nameLevel = styleChain.map((s) => HEADING.exec(s.name)?.[1]).find((v) => v !== undefined);
    const outline = pick([own.outline, ...styleChain.map((s) => s.para.outline)]);
    const heading = nameLevel ? Number(nameLevel) : (outline ?? 0);
    const align =
      pick([own.align, ...styleChain.map((s) => s.para.align), defaultPara.align]) ?? 'left';
    const line = pick([own.line, ...styleChain.map((s) => s.para.line), defaultPara.line]);
    const numbered = !!pick([own.numbered, ...styleChain.map((s) => s.para.numbered)]);

    const runs: Run[] = [];
    // Runs anywhere in the paragraph (inside hyperlinks, fields, content controls, insertions),
    // except deleted text and field instructions.
    for (const r of descendants(p, 'r')) {
      if (r.parent && 'name' in r.parent && /(^|:)del$/.test(r.parent.name)) continue;
      const text =
        children(r, 't').map(textContent).join('') + (children(r, 'tab').length ? '\t' : '');
      if (!text) continue;
      const rPr = child(r, 'rPr');
      const rStyle = chain(attr(child(rPr, 'rStyle'), 'val'));
      const own = runProps(rPr, theme);
      const layers = [
        own,
        ...rStyle.map((s) => s.run),
        ...styleChain.map((s) => s.run),
        defaultRun,
      ];
      runs.push({
        text,
        sizePt: (pick(layers.map((l) => l.sizeHalfPt)) ?? 20) / 2,
        font: pick(layers.map((l) => l.font)) ?? '',
        bold: pick(layers.map((l) => l.bold)) ?? false,
      });
    }
    let inTable = false;
    for (let up = p.parent; up && 'name' in up; up = up.parent) {
      if (/(^|:)tbl$/.test(up.name)) {
        inTable = true;
        break;
      }
    }
    paragraphs.push({
      inTable,
      text: runs.map((r) => r.text).join(''),
      runs,
      heading,
      align,
      lineFactor: line ? line / 240 : null,
      numbered,
    });
  }

  const tables = descendants(body, 'tbl').map((t) => {
    const rows = children(t, 'tr');
    return { rows: rows.length, cols: Math.max(0, ...rows.map((r) => children(r, 'tc').length)) };
  });
  // Pictures: modern drawings, and old VML pictures (still written by some programs).
  const images =
    descendants(body, 'drawing').filter((d) => descendants(d, 'blip').length > 0).length +
    descendants(body, 'pict').filter((p) => descendants(p, 'imagedata').length > 0).length;

  return { paragraphs, tables, images };
}

const pct = (n: number): string => `${Math.round(n * 100)} %`;

export function runDocx(m: DocxModel, check: DocxCheck): Verdict {
  // All text that is not a heading: for fonts. The running text — no tables, no lists: for
  // alignment and spacing, the way a teacher looks at "the text of the essay".
  const body = m.paragraphs.filter((p) => p.heading === 0 && p.text.trim());
  const prose = body.filter((p) => !p.inTable && !p.numbered);
  const chars = (paras: Paragraph[], ok: (r: Run) => boolean): number => {
    let all = 0;
    let good = 0;
    for (const p of paras) {
      for (const r of p.runs) {
        const n = r.text.replace(/\s/g, '').length;
        all += n;
        if (ok(r)) good += n;
      }
    }
    return all === 0 ? 0 : good / all;
  };

  switch (check.type) {
    case 'docx.headings': {
      const n = m.paragraphs.filter((p) => p.heading === check.level && p.text.trim()).length;
      return verdict(n >= check.min, `заголовков ${check.level}-го уровня: ${n}`);
    }
    case 'docx.font': {
      if (body.length === 0) return verdict(false, 'нет основного текста');
      const share = chars(
        body,
        (r) =>
          (check.family === undefined || fold(r.font) === fold(check.family)) &&
          (check.sizePt === undefined || Math.abs(r.sizePt - check.sizePt) < 0.26),
      );
      const common = mostCommon(
        body.flatMap((p) =>
          p.runs.map((r): [string, number] => [`${r.font} ${r.sizePt} пт`, r.text.length]),
        ),
      );
      return verdict(
        share >= check.share,
        `нужный шрифт у ${pct(share)} текста; чаще всего ${common}`,
      );
    }
    case 'docx.table': {
      const ok = m.tables.filter((t) => t.rows >= check.minRows && t.cols >= check.minCols).length;
      return verdict(ok >= check.min, `таблиц: ${m.tables.length}`);
    }
    case 'docx.image':
      return verdict(m.images >= check.min, `картинок: ${m.images}`);
    case 'docx.list': {
      const n = m.paragraphs.filter((p) => p.numbered && p.text.trim()).length;
      return verdict(n >= check.minItems, `пунктов списка: ${n}`);
    }
    case 'docx.text': {
      const all = fold(m.paragraphs.map((p) => p.text).join('\n'), check.caseSensitive);
      return verdict(all.includes(fold(check.contains, check.caseSensitive)), null);
    }
    case 'docx.paragraphs': {
      const n = m.paragraphs.filter((p) => p.text.trim()).length;
      return verdict(n >= check.min, `абзацев с текстом: ${n}`);
    }
    case 'docx.align': {
      const target =
        check.target === 'headings'
          ? m.paragraphs.filter((p) => p.heading > 0 && p.text.trim())
          : prose;
      if (target.length === 0)
        return verdict(false, check.target === 'headings' ? 'нет заголовков' : 'нет текста');
      const share = target.filter((p) => p.align === check.align).length / target.length;
      return verdict(share >= check.share, `так выровнено ${pct(share)} абзацев`);
    }
    case 'docx.bold': {
      if (check.text) {
        const want = fold(check.text);
        const found = m.paragraphs.some((p) =>
          fold(
            p.runs
              .filter((r) => r.bold)
              .map((r) => r.text)
              .join(''),
          ).includes(want),
        );
        return verdict(found, null);
      }
      const any = m.paragraphs.some(
        (p) => p.heading === 0 && p.runs.some((r) => r.bold && r.text.trim()),
      );
      return verdict(any, null);
    }
    case 'docx.lineSpacing': {
      if (prose.length === 0) return verdict(false, 'нет основного текста');
      const share =
        prose.filter((p) => Math.abs((p.lineFactor ?? 1) - check.value) < 0.05).length /
        prose.length;
      return verdict(share >= check.share, `такой интервал у ${pct(share)} абзацев`);
    }
  }
}

/** The value that covers the most text. */
function mostCommon(values: [string, number][]): string {
  const counts = new Map<string, number>();
  for (const [v, weight] of values) counts.set(v, (counts.get(v) ?? 0) + weight);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
}
