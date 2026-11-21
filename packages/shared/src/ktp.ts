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

export const KtpRowSchema = KtpRowInputSchema.extend({
  id: z.string().min(1),
  position: z.number().int().nonnegative(),
  /** The lesson this topic is taught with (W11), the author's or the teacher's. */
  lessonId: z.string().nullable(),
  lessonTitle: z.string().nullable(),
  /** Marked "done" by the teacher, or confirmed after a lesson (W11). */
  isDone: z.boolean(),
  doneAt: z.string().nullable(),
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
  updatedAt: z.string().min(1),
});
export type KtpPlanSummary = z.infer<typeof KtpPlanSummarySchema>;

export const KtpPlanSchema = KtpPlanSummarySchema.extend({
  items: z.array(KtpRowSchema),
});
export type KtpPlan = z.infer<typeof KtpPlanSchema>;

export const KtpListResponseSchema = z.strictObject({ plans: z.array(KtpPlanSummarySchema) });
export type KtpListResponse = z.infer<typeof KtpListResponseSchema>;

export const ParsedTablesSchema = z.strictObject({
  tables: z.array(z.strictObject({ name: z.string(), rows: z.array(z.array(z.string())) })),
});
export type ParsedTables = z.infer<typeof ParsedTablesSchema>;

// ---------- the column wizard (PLAN.md 5.2, 5.5)

export const KTP_FIELDS = ['number', 'topic', 'hours', 'weekOrDate', 'note'] as const;
export type KtpField = (typeof KTP_FIELDS)[number];
/** Column index per field; -1 — not in the file. */
export type KtpMapping = Record<KtpField, number>;

const fold = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

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
