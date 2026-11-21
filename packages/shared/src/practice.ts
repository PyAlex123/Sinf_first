import { z } from 'zod';
import { GradeThresholdsSchema } from './results.js';

/**
 * A practice task in a real program (CLAUDE.md §4.7; PLAN.md 3.6–3.7; stage 3, H13; ADR-016):
 * which program, which file the child starts from, what the saved file must have, how many points
 * each criterion is worth and where the grades begin.
 *
 * Criteria are data, not code (ADR-003): a check names a ready-made test and its parameters
 * ("headings of level 1, at least 1"; "cell C5 holds SUM"). The constructor (3.7) assembles them;
 * `packages/checkers` runs them in the browser, in the classroom app and on the server alike.
 */

const text = z.string().min(1).max(200);
const count = z.number().int().min(0).max(10_000);
/** "C5", "$B$2" — a cell of the first sheet unless a sheet is named. */
const cell = z
  .string()
  .regex(/^\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6}$/)
  .transform((s) => s.replace(/\$/g, '').toUpperCase());

/** At least this share of the text must have it: a stray space in another font is not a failure. */
const share = z.number().min(0).max(1).default(0.9);

export const DocxCheckSchema = z.discriminatedUnion('type', [
  /** "Есть заголовок 1-го уровня": headings by style or outline level, in any language of Word. */
  z.strictObject({
    type: z.literal('docx.headings'),
    level: z.number().int().min(1).max(6),
    min: count.default(1),
  }),
  /** "Шрифт 14 пт" (and/or a family) for the body text. */
  z.strictObject({
    type: z.literal('docx.font'),
    family: text.optional(),
    sizePt: z.number().min(4).max(96).optional(),
    share,
  }),
  z.strictObject({
    type: z.literal('docx.table'),
    min: count.default(1),
    minRows: count.default(1),
    minCols: count.default(1),
  }),
  z.strictObject({ type: z.literal('docx.image'), min: count.default(1) }),
  /** Numbered or bulleted list items. */
  z.strictObject({ type: z.literal('docx.list'), minItems: count.default(2) }),
  z.strictObject({
    type: z.literal('docx.text'),
    contains: text,
    caseSensitive: z.boolean().default(false),
  }),
  /** Paragraphs that have text. */
  z.strictObject({ type: z.literal('docx.paragraphs'), min: count }),
  /** Alignment of the body text, or of the headings. */
  z.strictObject({
    type: z.literal('docx.align'),
    align: z.enum(['left', 'center', 'right', 'both']),
    target: z.enum(['body', 'headings']).default('body'),
    share,
  }),
  /** Some text in bold (or exactly this text in bold). */
  z.strictObject({ type: z.literal('docx.bold'), text: text.optional() }),
  /** Line spacing of the body text: 1, 1.15, 1.5, 2. */
  z.strictObject({ type: z.literal('docx.lineSpacing'), value: z.number().min(0.5).max(4), share }),
]);

export const XlsxCheckSchema = z.discriminatedUnion('type', [
  /** The value Excel shows in a cell (the result of a formula, when there is one). */
  z.strictObject({
    type: z.literal('xlsx.value'),
    cell,
    sheet: text.optional(),
    equals: z.union([z.number(), z.string()]),
    tolerance: z.number().min(0).default(0.005),
  }),
  /** "В ячейке C5 формула СУММ": a formula there, optionally using this function. */
  z.strictObject({
    type: z.literal('xlsx.formula'),
    cell,
    sheet: text.optional(),
    function: z
      .string()
      .regex(/^[A-Za-z.]+$/)
      .transform((s) => s.toUpperCase())
      .optional(),
  }),
  /** Formulas anywhere on the sheet: the table counts by itself. */
  z.strictObject({
    type: z.literal('xlsx.formulas'),
    min: count.default(1),
    sheet: text.optional(),
  }),
  z.strictObject({
    type: z.literal('xlsx.numberFormat'),
    cell,
    sheet: text.optional(),
    kind: z.enum(['percent', 'date', 'currency', 'decimal', 'integer']),
  }),
  z.strictObject({ type: z.literal('xlsx.bold'), cell, sheet: text.optional() }),
  /** A cell filled with a colour. */
  z.strictObject({ type: z.literal('xlsx.fill'), cell, sheet: text.optional() }),
  z.strictObject({
    type: z.literal('xlsx.chart'),
    min: count.default(1),
    kind: z.enum(['bar', 'line', 'pie', 'area', 'scatter', 'any']).default('any'),
  }),
  z.strictObject({ type: z.literal('xlsx.sheets'), min: count.default(1) }),
  /** Filled cells on a sheet: the table has been typed in. */
  z.strictObject({ type: z.literal('xlsx.filled'), min: count, sheet: text.optional() }),
  z.strictObject({ type: z.literal('xlsx.border'), cell, sheet: text.optional() }),
]);

export const PptxCheckSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('pptx.slides'), min: count.default(1), max: count.optional() }),
  /** Every slide (or slide N) has a title with text. */
  z.strictObject({ type: z.literal('pptx.titles'), slide: z.number().int().min(1).optional() }),
  z.strictObject({ type: z.literal('pptx.image'), min: count.default(1) }),
  z.strictObject({
    type: z.literal('pptx.text'),
    contains: text,
    caseSensitive: z.boolean().default(false),
  }),
  /** Different slide layouts used (title slide, title and content, …). */
  z.strictObject({ type: z.literal('pptx.layouts'), min: count.default(2) }),
  z.strictObject({ type: z.literal('pptx.transitions'), min: count.default(1) }),
  z.strictObject({ type: z.literal('pptx.notes'), min: count.default(1) }),
  /** A table or a chart on some slide. */
  z.strictObject({ type: z.literal('pptx.table'), min: count.default(1) }),
  z.strictObject({ type: z.literal('pptx.chart'), min: count.default(1) }),
]);

export const HtmlCheckSchema = z.discriminatedUnion('type', [
  /** "В HTML есть тег <table>". */
  z.strictObject({
    type: z.literal('html.tag'),
    tag: z.string().regex(/^[a-z][a-z0-9-]*$/),
    min: count.default(1),
  }),
  z.strictObject({
    type: z.literal('html.attr'),
    tag: z.string().regex(/^[a-z][a-z0-9-]*$/),
    attr: z.string().regex(/^[a-z][a-z0-9-]*$/),
    value: text.optional(),
  }),
  z.strictObject({ type: z.literal('html.title'), contains: text.optional() }),
  /** Links; external or not. */
  z.strictObject({ type: z.literal('html.links'), min: count.default(1) }),
  /** Images, and that each has alt text. */
  z.strictObject({
    type: z.literal('html.images'),
    min: count.default(1),
    alt: z.boolean().default(false),
  }),
  z.strictObject({
    type: z.literal('html.table'),
    minRows: count.default(2),
    minCols: count.default(2),
  }),
  /** A list with this many items. */
  z.strictObject({ type: z.literal('html.list'), minItems: count.default(2) }),
  /** Doctype present and every opened tag closed. */
  z.strictObject({ type: z.literal('html.wellFormed') }),
  z.strictObject({
    type: z.literal('html.text'),
    contains: text,
    caseSensitive: z.boolean().default(false),
  }),
  /** A CSS property set — in a <style>, a style="" attribute or a .css file. */
  z.strictObject({
    type: z.literal('css.property'),
    property: z.string().regex(/^-?[a-z][a-z-]*$/),
    value: text.optional(),
    selector: text.optional(),
  }),
  /** The page uses a stylesheet: <link rel="stylesheet"> or <style>. */
  z.strictObject({ type: z.literal('css.linked') }),
]);

export const TxtCheckSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('txt.notEmpty') }),
  z.strictObject({
    type: z.literal('txt.contains'),
    text,
    caseSensitive: z.boolean().default(false),
  }),
  z.strictObject({
    type: z.literal('txt.notContains'),
    text,
    caseSensitive: z.boolean().default(false),
  }),
  z.strictObject({ type: z.literal('txt.lines'), min: count }),
  z.strictObject({ type: z.literal('txt.words'), min: count }),
  z.strictObject({ type: z.literal('txt.chars'), min: count }),
  /** A pattern the author writes (a JavaScript regular expression, without the slashes). */
  z.strictObject({
    type: z.literal('txt.matches'),
    pattern: z.string().min(1).max(300),
    flags: z
      .string()
      .regex(/^[imsu]*$/)
      .default('i'),
  }),
  z.strictObject({
    type: z.literal('txt.startsWith'),
    text,
    caseSensitive: z.boolean().default(false),
  }),
  z.strictObject({
    type: z.literal('txt.endsWith'),
    text,
    caseSensitive: z.boolean().default(false),
  }),
]);

/** A name in a program: `blink`, `Serial.begin`, `total_sum`. */
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/);

/**
 * A Scratch 3 project (`.sb3`; stage 6, B5): a ZIP with `project.json`, whose sprites hold their
 * scripts as blocks named by opcode ("event_whenflagclicked", "control_repeat").
 */
export const Sb3CheckSchema = z.discriminatedUnion('type', [
  /** Sprites besides the stage. */
  z.strictObject({ type: z.literal('sb3.sprites'), min: count.default(1) }),
  /** A script starts when the green flag is clicked. */
  z.strictObject({ type: z.literal('sb3.flag') }),
  /** "repeat", "forever" or "repeat until". */
  z.strictObject({ type: z.literal('sb3.loop') }),
  /** "if", "if … else" or "wait until". */
  z.strictObject({ type: z.literal('sb3.condition') }),
  /** Variables or lists the child made. */
  z.strictObject({ type: z.literal('sb3.variable'), min: count.default(1) }),
  /** A sound is played. */
  z.strictObject({ type: z.literal('sb3.sound') }),
  /** Blocks in scripts, the menus inside blocks not counted. */
  z.strictObject({ type: z.literal('sb3.blocks'), min: count }),
  /** Any block by its opcode, for what the ready-made checks do not name. */
  z.strictObject({
    type: z.literal('sb3.block'),
    opcode: z.string().regex(/^[a-z0-9]+_[a-z0-9_]+$/),
    min: count.default(1),
  }),
]);

/** An Arduino sketch (`.ino`; B5): read as code, never compiled here. */
export const InoCheckSchema = z.discriminatedUnion('type', [
  /** `void setup()` and `void loop()` are both there. */
  z.strictObject({ type: z.literal('ino.structure') }),
  /** A function is called: `pinMode`, `digitalWrite`, `delay`, `Serial.begin`. */
  z.strictObject({ type: z.literal('ino.call'), name: identifier, min: count.default(1) }),
  /** A pin is used by pinMode, digitalWrite, digitalRead, analogRead or analogWrite. */
  z.strictObject({
    type: z.literal('ino.pin'),
    pin: z.string().regex(/^(?:[0-9]{1,2}|A[0-9]{1,2}|LED_BUILTIN)$/),
  }),
  /** Brackets and quotes are closed. */
  z.strictObject({ type: z.literal('ino.balanced') }),
]);

export const PY_CONSTRUCTS = [
  'for',
  'while',
  'if',
  'def',
  'return',
  'import',
  'input',
  'print',
  'list',
  'try',
] as const;

/** A Python program (`.py`; B5): read, not run (ADR-016, addendum B5). */
export const PyCheckSchema = z.discriminatedUnion('type', [
  /** A function is declared: this one, or any. */
  z.strictObject({ type: z.literal('py.function'), name: identifier.optional() }),
  /** A variable gets a value. */
  z.strictObject({ type: z.literal('py.variable'), name: identifier }),
  /** The program uses a loop, a condition, input… */
  z.strictObject({ type: z.literal('py.uses'), construct: z.enum(PY_CONSTRUCTS) }),
  /** It prints this text (in a string given to print). */
  z.strictObject({
    type: z.literal('py.prints'),
    text,
    caseSensitive: z.boolean().default(false),
  }),
  /** Brackets and quotes closed, a block after every colon, indentation that lines up. */
  z.strictObject({ type: z.literal('py.syntax') }),
]);

export const PracticeCheckSchema = z.union([
  DocxCheckSchema,
  XlsxCheckSchema,
  PptxCheckSchema,
  HtmlCheckSchema,
  TxtCheckSchema,
  Sb3CheckSchema,
  InoCheckSchema,
  PyCheckSchema,
]);
export type PracticeCheck = z.infer<typeof PracticeCheckSchema>;

/** What a criterion says, as the child and the teacher read it. */
const LabelSchema = z.strictObject({ ru: text, uz: text });

export const CriterionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    kind: z.literal('auto'),
    label: LabelSchema,
    points: z.number().int().min(1).max(100),
    check: PracticeCheckSchema,
  }),
  /** Marked by the teacher when looking at the work. */
  z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    kind: z.literal('manual'),
    label: LabelSchema,
    points: z.number().int().min(1).max(100),
  }),
]);
export type Criterion = z.infer<typeof CriterionSchema>;

/** Programs a practice can use; a school computer finds them itself (H15). */
export const PRACTICE_APPS = [
  'word',
  'excel',
  'powerpoint',
  'notepad',
  'paint',
  'browser',
  'scratch',
  'arduino',
  'python',
] as const;
export const PracticeAppSchema = z.enum(PRACTICE_APPS);
export type PracticeApp = z.infer<typeof PracticeAppSchema>;

/** The file a practice is about, by program. */
export const PRACTICE_FILE_EXTENSIONS: Record<PracticeApp, readonly string[]> = {
  word: ['docx'],
  excel: ['xlsx'],
  powerpoint: ['pptx'],
  notepad: ['txt', 'html', 'htm', 'css'],
  paint: ['png', 'jpg', 'jpeg', 'bmp'],
  browser: ['html', 'htm'],
  scratch: ['sb3'],
  arduino: ['ino'],
  python: ['py'],
};

export const PracticeTaskSchema = z
  .strictObject({
    app: PracticeAppSchema,
    /** The name the child's file gets in "Мои работы": "Документ.docx". */
    fileName: z.string().min(1).max(120),
    /** A file in the course's media to start from; none means an empty document. */
    template: z.string().min(1).max(200).nullable().default(null),
    criteria: z.array(CriterionSchema).min(1).max(30),
    thresholds: GradeThresholdsSchema.optional(),
    /** The child sees their check-list (CLAUDE.md §4.7: "if the teacher turned it on"). */
    showChecklist: z.boolean().default(true),
  })
  .refine((t) => new Set(t.criteria.map((c) => c.id)).size === t.criteria.length, {
    message: 'criterion ids must be unique',
  });
export type PracticeTask = z.infer<typeof PracticeTaskSchema>;

// ---------- results

export const CheckOutcomeSchema = z.enum(['pass', 'fail', 'unknown']);
export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;

export const CriterionResultSchema = z.strictObject({
  id: z.string().min(1),
  outcome: CheckOutcomeSchema,
  /** What was found, for the teacher: "шрифт 12 пт у 80 % текста". Short and plain. */
  found: z.string().max(200).nullable().default(null),
});
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

export const CheckReportSchema = z.strictObject({
  /** `unreadable` — not the format it says; `old_or_protected` — .doc/.xls or a password. */
  file: z.enum(['ok', 'unreadable', 'old_or_protected', 'wrong_type']),
  results: z.array(CriterionResultSchema),
  /** Points of the automatic criteria that passed. */
  autoScore: z.number().int().nonnegative(),
  autoMax: z.number().int().nonnegative(),
  ms: z.number().nonnegative(),
});
export type CheckReport = z.infer<typeof CheckReportSchema>;

// ---------- the practice in a lesson (stage 3, H16)

const criterionId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/**
 * What the lesson's state carries about a child's latest checked file: enough for the teacher's tile
 * ("3/5") and the child's check-list. Only the automatic criteria: the manual ones are the teacher's.
 */
export const PracticeCheckStateSchema = z.strictObject({
  fileName: z.string().min(1).max(260),
  file: CheckReportSchema.shape.file,
  /** Automatic criteria that passed, of all automatic criteria. */
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  outcomes: z.record(criterionId, CheckOutcomeSchema),
  /** Server time of the check. */
  at: z.number(),
});
export type PracticeCheckState = z.infer<typeof PracticeCheckStateSchema>;

/** The teacher's marks: a manual criterion met or not, or an automatic one decided by hand. */
export const PracticeMarksSchema = z.record(criterionId, z.boolean());
export type PracticeMarks = z.infer<typeof PracticeMarksSchema>;

/** `null` takes a mark back: a manual criterion is unmarked again, an automatic one is the checker's. */
export const SetPracticeMarksSchema = z.strictObject({
  studentId: z.string().min(1),
  marks: z.record(criterionId, z.boolean().nullable()),
});
export type SetPracticeMarks = z.infer<typeof SetPracticeMarksSchema>;

/** `GET /api/lessons/:id/practice`: most lessons have none, and that is said plainly. */
export const PracticeResponseSchema = z.strictObject({ practice: PracticeTaskSchema.nullable() });
export type PracticeResponse = z.infer<typeof PracticeResponseSchema>;

/** Whether a saved file is the practice's: its kind is the program's (the name may differ). */
export function isPracticeFile(task: Pick<PracticeTask, 'app'>, name: string): boolean {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return PRACTICE_FILE_EXTENSIONS[task.app].includes(ext);
}

export function checkState(
  task: PracticeTask,
  fileName: string,
  report: CheckReport,
  at: number,
): PracticeCheckState {
  const auto = task.criteria.filter((c) => c.kind === 'auto');
  const outcomes: Record<string, CheckOutcome> = {};
  for (const r of report.results) outcomes[r.id] = r.outcome;
  return {
    fileName: fileName.slice(0, 260),
    file: report.file,
    passed: auto.filter((c) => outcomes[c.id] === 'pass').length,
    total: auto.length,
    outcomes,
    at,
  };
}

export interface PracticeScore {
  /** Each criterion as it stands: the teacher's mark over the checker's verdict. */
  outcomes: Record<string, CheckOutcome>;
  points: number;
  max: number;
}

/**
 * Points of a practice (CLAUDE.md §4.7): a criterion counts when it passed — by the checker, or by
 * the teacher's mark, which always wins. A criterion the checker could not decide counts nothing
 * until the teacher looks; a manual one, until the teacher marks it.
 */
export function practiceScore(
  task: Pick<PracticeTask, 'criteria'>,
  report: Pick<CheckReport, 'results'> | null,
  marks: PracticeMarks,
): PracticeScore {
  const outcomes: Record<string, CheckOutcome> = {};
  let points = 0;
  let max = 0;
  for (const c of task.criteria) {
    max += c.points;
    const mark = marks[c.id];
    const checked =
      c.kind === 'auto' ? report?.results.find((r) => r.id === c.id)?.outcome : undefined;
    const outcome: CheckOutcome =
      mark === true ? 'pass' : mark === false ? 'fail' : (checked ?? 'unknown');
    outcomes[c.id] = outcome;
    if (outcome === 'pass') points += c.points;
  }
  return { outcomes, points, max };
}
