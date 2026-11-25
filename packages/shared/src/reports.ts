import { z } from 'zod';

/**
 * Reports (PLAN.md 8.2; stage 6, B1): what the school's administrator and a class's teacher read
 * about a period — lessons held, attendance, grades and the KTP — by class, by parallel and by child.
 * Made from the same journal the teacher keeps (W9), so the numbers always agree with it.
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ReportQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const GradeCountsSchema = z.strictObject({
  five: z.number().int().nonnegative(),
  four: z.number().int().nonnegative(),
  three: z.number().int().nonnegative(),
  two: z.number().int().nonnegative(),
});
export type GradeCounts = z.infer<typeof GradeCountsSchema>;

export const KtpProgressSchema = z.strictObject({
  /** Topics of the class's KTPs. */
  rows: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** Due by the end of the period by their dates; null when the KTP has no dates. */
  planned: z.number().int().nonnegative().nullable(),
});
export type KtpProgress = z.infer<typeof KtpProgressSchema>;

/** One class, or a whole parallel (all the 5th classes) when `classId` is null. */
export const ReportRowSchema = z.strictObject({
  classId: z.string().nullable(),
  name: z.string().min(1),
  grade: z.number().int().min(1).max(11),
  students: z.number().int().nonnegative(),
  /** Lessons held in the period (journal columns of lessons). */
  lessons: z.number().int().nonnegative(),
  /** Children at the lessons out of children on the list, in percent; null without lessons. */
  attendance: z.number().min(0).max(100).nullable(),
  /** Confirmed grades 2–5 of the period: lessons and the teacher's own columns. */
  grades: GradeCountsSchema,
  average: z.number().min(2).max(5).nullable(),
  ktp: KtpProgressSchema.nullable(),
});
export type ReportRow = z.infer<typeof ReportRowSchema>;

export const SchoolReportSchema = z.strictObject({
  school: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
  from: dateString,
  to: dateString,
  classes: z.array(ReportRowSchema),
  parallels: z.array(ReportRowSchema),
});
export type SchoolReport = z.infer<typeof SchoolReportSchema>;

export const ClassReportStudentSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  present: z.number().int().nonnegative(),
  lessons: z.number().int().nonnegative(),
  grades: GradeCountsSchema,
  average: z.number().min(2).max(5).nullable(),
});
export type ClassReportStudent = z.infer<typeof ClassReportStudentSchema>;

export const ClassReportSchema = z.strictObject({
  from: dateString,
  to: dateString,
  summary: ReportRowSchema,
  students: z.array(ClassReportStudentSchema),
});
export type ClassReport = z.infer<typeof ClassReportSchema>;

/** The school year so far: from 1 September (of last year before September) to `today`. */
export function schoolYearSoFar(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const start = month >= 9 ? year : year - 1;
  return { from: `${start}-09-01`, to: today };
}

export function emptyGradeCounts(): GradeCounts {
  return { five: 0, four: 0, three: 0, two: 0 };
}

export function countGrade(counts: GradeCounts, value: number): void {
  if (value === 5) counts.five += 1;
  else if (value === 4) counts.four += 1;
  else if (value === 3) counts.three += 1;
  else if (value === 2) counts.two += 1;
}

export function averageOf(counts: GradeCounts): number | null {
  const n = counts.five + counts.four + counts.three + counts.two;
  if (n === 0) return null;
  const sum = 5 * counts.five + 4 * counts.four + 3 * counts.three + 2 * counts.two;
  return Math.round((sum / n) * 100) / 100;
}
