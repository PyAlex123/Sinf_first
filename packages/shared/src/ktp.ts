import { z } from 'zod';

/**
 * The calendar-thematic plan (КТП; CLAUDE.md §4.10; PLAN.md 5.2–5.3; stage 4, W10–W11): the
 * teacher's own plan of the year, imported from Excel or Word, row by row: number, topic, hours,
 * week or date, note. Rows are tied to lessons and marked "done".
 */

const text = (max: number) => z.string().trim().max(max);

export const KtpRowInputSchema = z.strictObject({
  number: text(12).default(''),
  topic: z.string().trim().min(1).max(300),
  hours: z.number().min(0).max(20).nullable().default(null),
  weekOrDate: text(40).default(''),
  note: text(300).default(''),
});
export type KtpRowInput = z.infer<typeof KtpRowInputSchema>;

export const MAX_KTP_ROWS = 400;

export const CreateKtpSchema = z.strictObject({
  classId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  sourceFile: text(200).default(''),
  rows: z.array(KtpRowInputSchema).min(1).max(MAX_KTP_ROWS),
});
export type CreateKtp = z.infer<typeof CreateKtpSchema>;

const LessonRefSchema = z.strictObject({ id: z.string().min(1), title: z.string().min(1) });
export type KtpLessonRef = z.infer<typeof LessonRefSchema>;

export const KtpRowSchema = KtpRowInputSchema.extend({
  id: z.string().min(1),
  position: z.number().int().nonnegative(),
  /** The lesson this topic is taught with (W11), the author's or the teacher's. */
  lessonId: z.string().nullable(),
  lessonTitle: z.string().nullable(),
  /** Marked "done" by the teacher, or confirmed after a lesson (W11). */
  isDone: z.boolean(),
  doneAt: z.string().nullable(),
  /** The last day the class had the linked lesson: "held — mark it done?" (W11). */
  heldAt: z.string().nullable(),
  /** A lesson whose title looks like the topic, for a topic without one (W11). */
  suggestion: LessonRefSchema.nullable(),
});
export type KtpRow = z.infer<typeof KtpRowSchema>;

export const KtpPlanSummarySchema = z.strictObject({
  id: z.string().min(1),
  classId: z.string().min(1),
  className: z.string().min(1),
  title: z.string().min(1),
  sourceFile: z.string(),
  rows: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** Topics due by today by their dates or weeks; null when the plan has neither (W11). */
  planned: z.number().int().nonnegative().nullable(),
  updatedAt: z.string().min(1),
});
export type KtpPlanSummary = z.infer<typeof KtpPlanSummarySchema>;

export const KtpChangesSchema = z.strictObject({
  /** Topics of the imported file. */
  base: z.number().int().nonnegative(),
  /** Of them changed (topic or date), removed, plus topics added by hand. */
  changed: z.number().int().nonnegative(),
  /** What the school allows, in percent (CLAUDE.md §4.10); 30 when the class has no school. */
  allowedPercent: z.number().int().min(0).max(100),
});
export type KtpChanges = z.infer<typeof KtpChangesSchema>;

export const KtpPlanSchema = KtpPlanSummarySchema.extend({
  items: z.array(KtpRowSchema),
  changes: KtpChangesSchema,
});
export type KtpPlan = z.infer<typeof KtpPlanSchema>;

export const KtpListResponseSchema = z.strictObject({ plans: z.array(KtpPlanSummarySchema) });
export type KtpListResponse = z.infer<typeof KtpListResponseSchema>;

export const UpdateKtpRowSchema = z
  .strictObject({
    number: text(12),
    topic: z.string().trim().min(1).max(300),
    hours: z.number().min(0).max(20).nullable(),
    weekOrDate: text(40),
    note: text(300),
    lessonId: z.string().min(1).max(64).nullable(),
    isDone: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateKtpRow = z.infer<typeof UpdateKtpRowSchema>;

export const AddKtpRowSchema = z.strictObject({
  row: KtpRowInputSchema,
  /** The new topic goes after this one; null — first. */
  afterId: z.string().min(1).nullable(),
});
export type AddKtpRow = z.infer<typeof AddKtpRowSchema>;

/** Several topics linked at once: "link all suggestions". */
export const LinkKtpRowsSchema = z.strictObject({
  links: z
    .array(z.strictObject({ rowId: z.string().min(1), lessonId: z.string().min(1).max(64) }))
    .min(1)
    .max(MAX_KTP_ROWS),
});
export type LinkKtpRows = z.infer<typeof LinkKtpRowsSchema>;

/** After a lesson (W11): the KTP topic to mark done, if the class has a KTP. */
export const SessionKtpSchema = z.strictObject({
  planId: z.string().min(1),
  planTitle: z.string().min(1),
  row: KtpRowSchema.nullable(),
  /** The row is linked to this lesson already; otherwise it is the next topic not done yet. */
  linked: z.boolean(),
});
export const SessionKtpResponseSchema = z.strictObject({ ktp: SessionKtpSchema.nullable() });
export type SessionKtpResponse = z.infer<typeof SessionKtpResponseSchema>;

export const KtpLessonsResponseSchema = z.strictObject({ lessons: z.array(LessonRefSchema) });
export type KtpLessonsResponse = z.infer<typeof KtpLessonsResponseSchema>;

export const ParsedTablesSchema = z.strictObject({
  tables: z.array(z.strictObject({ name: z.string(), rows: z.array(z.array(z.string())) })),
});
export type ParsedTables = z.infer<typeof ParsedTablesSchema>;

// ---------- the column wizard (PLAN.md 5.2, 5.5)

export const KTP_FIELDS = ['number', 'topic', 'hours', 'weekOrDate', 'note'] as const;
export type KtpField = (typeof KTP_FIELDS)[number];
/** Column index per field; -1 — not in the file. */
export type KtpMapping = Record<KtpField, number>;

/** Lower case, «ё» as «е», without the soft hyphens the author's titles carry. */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u00ad/g, '');

/** What a header says, in Russian and Uzbek, as teachers write it. */
const HEADER_HINTS: Record<KtpField, RegExp[]> = {
  number: [/^(n|no|n°|#|номер|т\/р|t\/r)\.?$|№/],
  topic: [/тем|mavzu|название|раздел/],
  hours: [/час|soat|кол/],
  // A date beats a week number when the file has both: the plan is followed by dates.
  weekOrDate: [/дат|sana|срок/, /недел|hafta/],
  note: [/примеч|izoh|коммент|изох/],
};

/**
 * Where the table's header is and which column is which, guessed from the words in the first rows.
 * The teacher sees the guess and corrects it.
 */
export function guessKtpMapping(rows: readonly string[][]): {
  header: number;
  mapping: KtpMapping;
} {
  let best = { header: 0, mapping: emptyMapping(), score: -1 };
  rows.slice(0, 10).forEach((row, r) => {
    const mapping = emptyMapping();
    let score = 0;
    for (const field of KTP_FIELDS) {
      let col = -1;
      for (const hint of HEADER_HINTS[field]) {
        col = row.findIndex(
          (cell, c) =>
            cell.length <= 40 &&
            hint.test(fold(cell.trim())) &&
            !Object.values(mapping).includes(c),
        );
        if (col >= 0) break;
      }
      if (col >= 0) {
        mapping[field] = col;
        score += field === 'topic' ? 3 : 1;
      }
    }
    if (score > best.score) best = { header: r, mapping, score };
  });
  // No header found: the widest text column is the topic.
  if (best.mapping.topic < 0) {
    const widths = (rows[0] ?? []).map((_, c) =>
      rows.reduce((sum, row) => sum + (row[c]?.length ?? 0), 0),
    );
    best.mapping.topic = widths.indexOf(Math.max(...widths, 0));
    best.header = -1;
  }
  return { header: best.header, mapping: best.mapping };
}

export function emptyMapping(): KtpMapping {
  return { number: -1, topic: -1, hours: -1, weekOrDate: -1, note: -1 };
}

export interface KtpPreviewRow {
  /** Row in the file, 1-based, for "row 14: …". */
  line: number;
  row: KtpRowInput | null;
  /** Why this row is skipped or doubtful. */
  problem: 'no_topic' | 'section' | 'bad_hours' | null;
}

/**
 * The file's rows as KTP rows. A row without a topic is skipped; a row whose only text spans the
 * width ("I четверть") is a section, skipped too; hours that are not a number are kept empty and
 * shown.
 */
export function mapKtpRows(
  rows: readonly string[][],
  header: number,
  mapping: KtpMapping,
): KtpPreviewRow[] {
  const at = (row: readonly string[], field: KtpField): string =>
    mapping[field] >= 0 ? (row[mapping[field]] ?? '').trim() : '';
  return rows.slice(header + 1).map((row, i): KtpPreviewRow => {
    const line = header + 2 + i;
    const topic = at(row, 'topic');
    const filled = row.map((c) => c.trim()).filter(Boolean);
    if (!topic) {
      // "I четверть" across the table is a section; a lone number is a row left empty.
      const section = filled.length === 1 && !/^\d+\.?$/.test(filled[0] ?? '');
      return { line, row: null, problem: section ? 'section' : 'no_topic' };
    }
    const hoursText = at(row, 'hours').replace(',', '.');
    const hours = hoursText === '' ? null : Number(hoursText);
    const bad = hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 20);
    return {
      line,
      row: {
        number: at(row, 'number').slice(0, 12),
        topic: topic.slice(0, 300),
        hours: bad ? null : hours,
        weekOrDate: at(row, 'weekOrDate').slice(0, 40),
        note: at(row, 'note').slice(0, 300),
      },
      problem: bad ? 'bad_hours' : null,
    };
  });
}

// ---------- where am I by the plan (W11)

/** The school year a day belongs to starts on 1 September; summer counts towards the next one. */
function yearStart(today: Date): number {
  return today.getUTCMonth() >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
}

/**
 * The day a KTP row is due: `03.09.2026`, `3.9.26`, `03.09` (the school year's), or a week number
 * (`5` — the fifth week from 1 September, its Monday). Anything else — null.
 */
export function ktpDueDate(weekOrDate: string, today: Date): Date | null {
  const text = weekOrDate.trim();
  const start = yearStart(today);
  const date = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?\b/.exec(text);
  if (date) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    let year = date[3] ? Number(date[3]) : month >= 8 ? start : start + 1;
    if (year < 100) year += 2000;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }
  const week = /^(\d{1,2})(?:\s*(?:-?я|нед\w*|hafta))?$/i.exec(text);
  if (week) {
    const n = Number(week[1]);
    if (n < 1 || n > 45) return null;
    const first = new Date(Date.UTC(start, 8, 1));
    // The week of 1 September is the first, from its Monday.
    const monday = Date.UTC(start, 8, 1) - ((first.getUTCDay() + 6) % 7) * 86_400_000;
    return new Date(monday + (n - 1) * 7 * 86_400_000);
  }
  return null;
}

/** How many topics are due by today; null when no row has a date or a week. */
export function ktpPlanned(rows: readonly { weekOrDate: string }[], today: Date): number | null {
  const dates = rows.map((r) => ktpDueDate(r.weekOrDate, today));
  if (dates.every((d) => d === null)) return null;
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  // A row without a date is due when the row after it is: plans write the date once per two lessons.
  let due = 0;
  dates.forEach((d, i) => {
    if (d && d.getTime() <= end) due = i + 1;
  });
  return due;
}

// ---------- a lesson for a topic (W11)

const STOP = new Set(['для', 'как', 'что', 'это', 'урок', 'тема', 'dars', 'mavzu', 'и', 'в', 'на']);

/** Words of a title as stems: folded, without the short and the common ones. */
function stems(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

/**
 * The lesson whose title shares most of the topic's words, if it shares at least half of them —
 * a guess the teacher confirms, never a link made silently.
 */
export function suggestLesson<T extends { title: string }>(
  topic: string,
  lessons: readonly T[],
): T | null {
  const want = stems(topic);
  if (want.size === 0) return null;
  let best: { lesson: T; score: number } | null = null;
  for (const lesson of lessons) {
    const have = stems(lesson.title);
    let common = 0;
    for (const w of want) if (have.has(w)) common += 1;
    const score = common / Math.max(want.size, have.size);
    if (common > 0 && score >= 0.5 && (!best || score > best.score)) best = { lesson, score };
  }
  return best?.lesson ?? null;
}

/** Whether the share of changes is over what the school allows. */
export function ktpChangesOver(changes: KtpChanges): boolean {
  return changes.base > 0 && (changes.changed * 100) / changes.base > changes.allowedPercent;
}

export const DEFAULT_KTP_CHANGE_PERCENT = 30;
