import { z } from 'zod';
import { ktpDueDate } from './ktp.js';

/**
 * Grades from a file (PLAN.md 5.5; stage 4, W13): a sheet the teacher kept before — names down,
 * dates across — read with the KTP's wizard (W10), its children matched to the class by surname and
 * first name, doubtful rows confirmed by the teacher, each column saved as a journal column (W9).
 */

const id = z.string().min(1);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const MAX_IMPORT_COLUMNS = 60;

export const ImportGradesSchema = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        date: dateString,
        title: z.string().trim().min(1).max(60),
        cells: z
          .array(
            z.strictObject({
              studentId: id,
              value: z.number().int().min(2).max(5).nullable(),
              absent: z.boolean(),
            }),
          )
          .max(80),
      }),
    )
    .min(1)
    .max(MAX_IMPORT_COLUMNS),
});
export type ImportGrades = z.infer<typeof ImportGradesSchema>;

// ---------- names

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ʻʼ‘’`']/g, '')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Edits between two words, for a typo in a name ("Алиев" / "Алеев"). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const here = row[j] ?? 0;
      row[j] = Math.min(here + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length] ?? 0;
}

export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
}

export interface NameMatch {
  /** The child this row is, when sure. */
  studentId: string | null;
  /**
   * `exact` — surname and name as on the list (either order); `doubt` — close, the teacher
   * confirms; `none` — nobody like it.
   */
  status: 'exact' | 'doubt' | 'none';
  /** For a doubt: who it may be, likeliest first. */
  candidates: string[];
}

/**
 * Who a name in the file is. "Алиев Тимур", "Тимур Алиев", "АЛИЕВ Т." and "Алиев Тимур Рустамович"
 * are all Алиев Тимур; a typo or a surname alone shared by two children is a doubt.
 */
export function matchStudent(name: string, roster: readonly RosterStudent[]): NameMatch {
  const words = fold(name).split(' ').filter(Boolean);
  if (words.length === 0) return { studentId: null, status: 'none', candidates: [] };
  const scored = roster
    .map((s) => {
      const last = fold(s.lastName);
      const first = fold(s.firstName);
      const has = (w: string) => words.includes(w);
      const initial = (w: string) =>
        words.some((x) => x.length <= 2 && w.startsWith(x.replace(/-/g, '')));
      let score = 0;
      if (has(last) && has(first)) score = 100;
      else if (has(last) && initial(first)) score = 90;
      else if (has(last)) score = 60;
      else {
        // A typo: the closest word to the surname and to the name.
        const near = (w: string) => Math.min(...words.map((x) => distance(x, w)));
        const dl = near(last);
        const df = near(first);
        if (dl <= 2 && (df <= 1 || initial(first))) score = 70 - dl * 5 - df * 5;
        else if (dl <= 1) score = 40;
      }
      return { id: s.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best) return { studentId: null, status: 'none', candidates: [] };
  const sure = best.score >= 90 && (!second || second.score < best.score);
  return sure
    ? { studentId: best.id, status: 'exact', candidates: [best.id] }
    : { studentId: null, status: 'doubt', candidates: scored.slice(0, 3).map((x) => x.id) };
}

// ---------- cells and headers

/** What a cell says: a grade 2–5, "н" (absent), or nothing to take. */
export function readGradeCell(text: string): { value: number | null; absent: boolean } | null {
  const t = fold(text).replace(/\s/g, '');
  const raw = text.trim();
  if (/^[2-5]([.,]0+)?$/.test(raw)) return { value: Number(raw[0]), absent: false };
  if (['н', 'нб', 'нн', 'n', 'nb', 'yoq', 'кел', 'kelmadi'].includes(t.replace(/[/-]/g, ''))) {
    return { value: null, absent: true };
  }
  return null;
}

/** A column header that is a date ("05.11", "05.11.2026"), as `yyyy-mm-dd`; else null. */
export function headerDate(text: string, today: Date): string | null {
  if (!/^\s*\d{1,2}[./-]\d{1,2}/.test(text)) return null;
  const d = ktpDueDate(text, today);
  return d ? d.toISOString().slice(0, 10) : null;
}
