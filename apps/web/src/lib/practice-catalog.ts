import type { PracticeApp, PracticeCheck } from '@sinf/shared';

/**
 * The ready-made checks a teacher assembles a practice task from (PLAN.md 3.7; H13). Each check has
 * its parameters described here, so the constructor draws one form for all of them; the meaning of
 * each check lives in `packages/checkers`.
 */

export type ParamKind = 'int' | 'number' | 'text' | 'cell' | 'bool' | 'choice' | 'numberOrText';

export interface ParamSpec {
  key: string;
  kind: ParamKind;
  optional?: boolean;
  options?: readonly string[];
}

export interface CheckSpec {
  type: PracticeCheck['type'];
  params: ParamSpec[];
  /** A starting value for a new criterion of this kind. */
  example: Record<string, unknown>;
}

const int = (key: string, optional = false): ParamSpec => ({ key, kind: 'int', optional });
const text = (key: string, optional = false): ParamSpec => ({ key, kind: 'text', optional });
const cell: ParamSpec = { key: 'cell', kind: 'cell' };
const sheet = text('sheet', true);
const caseSensitive: ParamSpec = { key: 'caseSensitive', kind: 'bool', optional: true };

export const CHECKS: readonly CheckSpec[] = [
  { type: 'docx.headings', params: [int('level'), int('min')], example: { level: 1, min: 1 } },
  {
    type: 'docx.font',
    params: [text('family', true), { key: 'sizePt', kind: 'number', optional: true }],
    example: { family: 'Times New Roman', sizePt: 14 },
  },
  {
    type: 'docx.table',
    params: [int('min'), int('minRows'), int('minCols')],
    example: { min: 1, minRows: 2, minCols: 2 },
  },
  { type: 'docx.image', params: [int('min')], example: { min: 1 } },
  { type: 'docx.list', params: [int('minItems')], example: { minItems: 3 } },
  { type: 'docx.text', params: [text('contains'), caseSensitive], example: { contains: '' } },
  { type: 'docx.paragraphs', params: [int('min')], example: { min: 3 } },
  {
    type: 'docx.align',
    params: [
      { key: 'align', kind: 'choice', options: ['left', 'center', 'right', 'both'] },
      { key: 'target', kind: 'choice', options: ['body', 'headings'] },
    ],
    example: { align: 'both', target: 'body' },
  },
  { type: 'docx.bold', params: [text('text', true)], example: {} },
  { type: 'docx.lineSpacing', params: [{ key: 'value', kind: 'number' }], example: { value: 1.5 } },

  {
    type: 'xlsx.value',
    params: [cell, { key: 'equals', kind: 'numberOrText' }, sheet],
    example: { cell: 'B5', equals: 0 },
  },
  {
    type: 'xlsx.formula',
    params: [cell, text('function', true), sheet],
    example: { cell: 'B5', function: 'SUM' },
  },
  { type: 'xlsx.formulas', params: [int('min'), sheet], example: { min: 1 } },
  {
    type: 'xlsx.numberFormat',
    params: [
      cell,
      {
        key: 'kind',
        kind: 'choice',
        options: ['percent', 'date', 'currency', 'decimal', 'integer'],
      },
      sheet,
    ],
    example: { cell: 'B2', kind: 'decimal' },
  },
  { type: 'xlsx.bold', params: [cell, sheet], example: { cell: 'A1' } },
  { type: 'xlsx.fill', params: [cell, sheet], example: { cell: 'A1' } },
  { type: 'xlsx.border', params: [cell, sheet], example: { cell: 'A1' } },
  {
    type: 'xlsx.chart',
    params: [
      int('min'),
      { key: 'kind', kind: 'choice', options: ['any', 'bar', 'line', 'pie', 'area', 'scatter'] },
    ],
    example: { min: 1, kind: 'any' },
  },
  { type: 'xlsx.sheets', params: [int('min')], example: { min: 2 } },
  { type: 'xlsx.filled', params: [int('min'), sheet], example: { min: 10 } },

  { type: 'pptx.slides', params: [int('min'), int('max', true)], example: { min: 3 } },
  { type: 'pptx.titles', params: [int('slide', true)], example: {} },
  { type: 'pptx.image', params: [int('min')], example: { min: 1 } },
  { type: 'pptx.text', params: [text('contains'), caseSensitive], example: { contains: '' } },
  { type: 'pptx.layouts', params: [int('min')], example: { min: 2 } },
  { type: 'pptx.transitions', params: [int('min')], example: { min: 1 } },
  { type: 'pptx.notes', params: [int('min')], example: { min: 1 } },
  { type: 'pptx.table', params: [int('min')], example: { min: 1 } },
  { type: 'pptx.chart', params: [int('min')], example: { min: 1 } },

  { type: 'html.tag', params: [text('tag'), int('min')], example: { tag: 'h1', min: 1 } },
  {
    type: 'html.attr',
    params: [text('tag'), text('attr'), text('value', true)],
    example: { tag: 'img', attr: 'alt' },
  },
  { type: 'html.title', params: [text('contains', true)], example: {} },
  { type: 'html.links', params: [int('min')], example: { min: 1 } },
  {
    type: 'html.images',
    params: [int('min'), { key: 'alt', kind: 'bool', optional: true }],
    example: { min: 1, alt: true },
  },
  {
    type: 'html.table',
    params: [int('minRows'), int('minCols')],
    example: { minRows: 2, minCols: 2 },
  },
  { type: 'html.list', params: [int('minItems')], example: { minItems: 3 } },
  { type: 'html.wellFormed', params: [], example: {} },
  { type: 'html.text', params: [text('contains'), caseSensitive], example: { contains: '' } },
  {
    type: 'css.property',
    params: [text('property'), text('value', true), text('selector', true)],
    example: { property: 'color', selector: 'h1' },
  },
  { type: 'css.linked', params: [], example: {} },

  { type: 'txt.notEmpty', params: [], example: {} },
  { type: 'txt.contains', params: [text('text'), caseSensitive], example: { text: '' } },
  { type: 'txt.notContains', params: [text('text'), caseSensitive], example: { text: '' } },
  { type: 'txt.lines', params: [int('min')], example: { min: 3 } },
  { type: 'txt.words', params: [int('min')], example: { min: 20 } },
  { type: 'txt.chars', params: [int('min')], example: { min: 100 } },
  { type: 'txt.matches', params: [text('pattern')], example: { pattern: '' } },
  { type: 'txt.startsWith', params: [text('text'), caseSensitive], example: { text: '' } },
  { type: 'txt.endsWith', params: [text('text'), caseSensitive], example: { text: '' } },
];

/** Which checks fit the program a practice uses. */
export const FAMILIES: Record<PracticeApp, readonly string[]> = {
  word: ['docx'],
  excel: ['xlsx'],
  powerpoint: ['pptx'],
  notepad: ['txt', 'html', 'css'],
  browser: ['html', 'css', 'txt'],
  paint: [],
};

export function checksFor(app: PracticeApp): CheckSpec[] {
  const families = FAMILIES[app];
  return CHECKS.filter((c) => families.includes(c.type.split('.')[0] ?? ''));
}
