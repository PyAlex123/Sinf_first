import { z } from 'zod';
import type { Lesson } from './lesson.js';

/**
 * Lesson results and the class journal (STAGE1 S1.13, ADR-012).
 *
 * Nothing here is stored: results are worked out from the rows the lesson left behind
 * (attendance, stars per screen, stars for the drawing, quiz answers) whenever somebody asks. Those
 * rows are exactly what a school computer sends to the platform (S2.6), so the same results come
 * out in the classroom and in the cloud.
 */

// ---------- stars → 2–5

const percent = z.number().int().min(0).max(100);

/** Lowest share of the lesson's stars for a 5, a 4 and a 3; below the last one it is a 2. */
export const GradeThresholdsSchema = z
  .strictObject({ five: percent, four: percent, three: percent })
  .refine((t) => t.five >= t.four && t.four >= t.three, {
    message: 'thresholds must not grow from 5 down to 3',
  });
export type GradeThresholds = z.infer<typeof GradeThresholdsSchema>;

/** The author's choice for S1.13: 90 % → 5, 70 % → 4, 50 % → 3, less → 2. */
export const DEFAULT_GRADE_THRESHOLDS: GradeThresholds = { five: 90, four: 70, three: 50 };

export const GradeValueSchema = z.number().int().min(2).max(5);
export type GradeValue = z.infer<typeof GradeValueSchema>;

export function gradeFor(percentValue: number, thresholds: GradeThresholds): GradeValue {
  if (percentValue >= thresholds.five) return 5;
  if (percentValue >= thresholds.four) return 4;
  if (percentValue >= thresholds.three) return 3;
  return 2;
}

/** Stars a Paint drawing can get from the teacher (S1.11). */
export const PRACTICE_MAX_STARS = 3;

/**
 * Stars a child can collect in the lesson's trainers: each level is worth the stars it carries, and
 * each "type the word" is worth one (that is what the player gives for them, S1.5).
 */
export function trainerMaxStars(lesson: Pick<Lesson, 'screens'>): number {
  let max = 0;
  for (const screen of lesson.screens) {
    if (screen.kind === 'game') max += screen.level.stars;
    if (screen.kind === 'type') max += 1;
  }
  return max;
}

/** Screens of the Paint practice — a lesson without them has no drawing to give stars for. */
export function practiceStepCount(lesson: Pick<Lesson, 'screens'>): number {
  return lesson.screens.filter((screen) => screen.kind === 'step').length;
}

/**
 * The most one child could have got in this lesson. A part counts only when it took place: the
 * drawing when the teacher gave stars to anybody at all, the quiz by the questions that were really
 * asked. A lesson that ran out of time must not lower everybody's grade for the part nobody saw.
 */
export interface LessonMaxima {
  trainer: number;
  practice: number;
  quiz: number;
}

export interface EarnedPoints {
  trainerStars: number;
  practiceStars: number;
  quizCorrect: number;
}

/** Share of the lesson's maximum, 0–100, or null when there was nothing to score. */
export function scorePercent(earned: EarnedPoints, max: LessonMaxima): number | null {
  const total = max.trainer + max.practice + max.quiz;
  if (total <= 0) return null;
  const got =
    Math.min(earned.trainerStars, max.trainer) +
    Math.min(earned.practiceStars, max.practice) +
    Math.min(earned.quizCorrect, max.quiz);
  return Math.round((100 * got) / total);
}

// ---------- the lesson date

/** Every school we serve keeps Tashkent time; a lesson at 8:00 there is still "today" (UTC+5). */
export const SCHOOL_TIME_ZONE = 'Asia/Tashkent';

/** `YYYY-MM-DD` of a moment as the school's clock shows it. */
export function lessonDate(iso: string, timeZone = SCHOOL_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `20.11.2026`: how a date is written in a school register. */
export function registerDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

// ---------- API shapes

const id = z.string().min(1);
const count = z.number().int().nonnegative();

/** The class as results need it: whether it has grades, and where they begin. */
const ResultClassSchema = z.strictObject({
  id,
  name: z.string().min(1),
  starsToGrade: z.boolean(),
  thresholds: GradeThresholdsSchema,
});

export const ResultRowSchema = z.strictObject({
  studentId: id,
  name: z.string().min(1),
  /** Switched off after the lesson (left the class); kept so old lessons stay whole. */
  isActive: z.boolean(),
  /** A demo student played by the server (S1.15). */
  isVirtual: z.boolean(),
  present: z.boolean(),
  trainerStars: count,
  /** Trainer screens finished. */
  screensDone: count,
  /** Null until the teacher gives stars for the drawing. */
  practiceStars: z.number().int().min(1).max(PRACTICE_MAX_STARS).nullable(),
  /** Paint steps the child marked as done; null when nothing tells us. */
  stepsDone: count.nullable(),
  quizPoints: count,
  quizCorrect: count,
  quizAnswered: count,
  /** Trainer stars plus stars for the drawing: what goes to the journal. */
  totalStars: count,
  /** Share of the lesson's maximum; null when absent or nothing could be scored. */
  percent: percent.nullable(),
  /** Only when the class turns stars into grades. */
  grade: GradeValueSchema.nullable(),
});
export type ResultRow = z.infer<typeof ResultRowSchema>;

export const SessionResultsSchema = z.strictObject({
  sessionId: id,
  lessonId: id,
  lessonTitle: z.string().min(1),
  status: z.enum(['active', 'ended']),
  /** `YYYY-MM-DD` in school time. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.string().min(1),
  endedAt: z.string().nullable(),
  class: ResultClassSchema,
  maxima: z.strictObject({ trainer: count, practice: count, quiz: count }),
  /** Steps of the Paint practice in this lesson; 0 when it has none. */
  practiceSteps: count,
  /** Questions of the lesson's quiz, asked or not; 0 when it has none. */
  quizQuestions: count,
  presentCount: count,
  rows: z.array(ResultRowSchema),
});
export type SessionResults = z.infer<typeof SessionResultsSchema>;

export const JournalCellSchema = z.strictObject({
  present: z.boolean(),
  stars: count,
  grade: GradeValueSchema.nullable(),
});
export type JournalCell = z.infer<typeof JournalCellSchema>;

export const JournalSchema = z.strictObject({
  class: ResultClassSchema,
  /** Ended lessons, oldest first: the columns. */
  lessons: z.array(
    z.strictObject({
      sessionId: id,
      lessonId: id,
      lessonTitle: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
  /** Alphabetical; `cells[i]` belongs to `lessons[i]`, null when the child was not on the list then. */
  students: z.array(
    z.strictObject({
      id,
      name: z.string().min(1),
      isActive: z.boolean(),
      isVirtual: z.boolean(),
      cells: z.array(JournalCellSchema.nullable()),
    }),
  ),
});
export type Journal = z.infer<typeof JournalSchema>;

export const UpdateClassSettingsSchema = z.strictObject({ starsToGrade: z.boolean() });
export type UpdateClassSettings = z.infer<typeof UpdateClassSettingsSchema>;
