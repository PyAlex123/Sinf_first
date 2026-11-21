import { z } from 'zod';
import { screenMaxStars, type Lesson } from './lesson.js';

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
  for (const screen of lesson.screens) max += screenMaxStars(screen);
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
  /** Points of the practice task in a real program (H16): its criteria, automatic and manual. */
  check?: number;
}

export interface EarnedPoints {
  trainerStars: number;
  practiceStars: number;
  quizCorrect: number;
  checkPoints?: number;
}

/**
 * Share of the lesson's maximum, 0–100, or null when there was nothing to score. Every star and
 * every point of a criterion weighs the same (ADR-012, addendum H16).
 */
export function scorePercent(earned: EarnedPoints, max: LessonMaxima): number | null {
  const check = max.check ?? 0;
  const total = max.trainer + max.practice + max.quiz + check;
  if (total <= 0) return null;
  const got =
    Math.min(earned.trainerStars, max.trainer) +
    Math.min(earned.practiceStars, max.practice) +
    Math.min(earned.quizCorrect, max.quiz) +
    Math.min(earned.checkPoints ?? 0, check);
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
/**
 * A child's practice file at the lesson (H16): the version handed in — the one photographed before
 * the end of the practice — or, until then, the latest one checked.
 */
export const ResultCheckSchema = z.strictObject({
  /** Null when the child saved nothing and only the teacher's marks are there. */
  fileName: z.string().min(1).nullable(),
  file: z.enum(['ok', 'unreadable', 'old_or_protected', 'wrong_type']).nullable(),
  /** Each criterion with the teacher's mark over the checker's verdict. */
  outcomes: z.record(z.string(), z.enum(['pass', 'fail', 'unknown'])),
  /** What the checker found, for the teacher: "шрифт 12 пт у 80 % текста". */
  found: z.record(z.string(), z.string()),
  /** The teacher's own marks, by criterion. */
  marks: z.record(z.string(), z.boolean()),
  points: count,
  max: count,
  /** Handed in: frozen with the photograph before the end of the practice (CLAUDE.md §4.8). */
  submitted: z.boolean(),
  checkedAt: z.string().min(1).nullable(),
});
export type ResultCheck = z.infer<typeof ResultCheckSchema>;

/** The practice task as the results need it: criteria to show and mark. */
export const ResultPracticeSchema = z.strictObject({
  app: z.string().min(1),
  fileName: z.string().min(1),
  criteria: z.array(
    z.strictObject({
      id: z.string().min(1),
      kind: z.enum(['auto', 'manual']),
      label: z.strictObject({ ru: z.string(), uz: z.string() }),
      points: count,
    }),
  ),
});
export type ResultPractice = z.infer<typeof ResultPracticeSchema>;

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
  /** The latest photograph of this child's screen in this lesson (H5), when the classroom app took one. */
  screenshotId: id.nullable(),
  /** The practice file and its criteria (H16); null without a practice task or before any save. */
  check: ResultCheckSchema.nullable(),
  /** Trainer stars plus stars for the drawing: what goes to the journal. */
  totalStars: count,
  /** Share of the lesson's maximum; null when absent or nothing could be scored. */
  percent: percent.nullable(),
  /**
   * The grade that stands: the one the teacher confirmed or set (H10), otherwise the suggested one.
   */
  grade: GradeValueSchema.nullable(),
  /** Worked out from the lesson's results; only when the class turns stars into grades. */
  suggestedGrade: GradeValueSchema.nullable(),
  /** The teacher has confirmed or set `grade`; until then it is only a suggestion. */
  gradeConfirmed: z.boolean(),
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
  maxima: z.strictObject({ trainer: count, practice: count, quiz: count, check: count }),
  /** The lesson's practice task in a real program (H16), if it has one. */
  practice: ResultPracticeSchema.nullable(),
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
  /** False while `grade` is only the calculated suggestion (H10). */
  confirmed: z.boolean(),
  /** The teacher's note on this grade (W9). */
  comment: z.string().nullable(),
});
export type JournalCell = z.infer<typeof JournalCellSchema>;

export const JournalSchema = z.strictObject({
  class: ResultClassSchema,
  /**
   * The columns, oldest first: ended lessons, and the teacher's own columns without a lesson (W9) —
   * a test on paper, oral answers.
   */
  lessons: z.array(
    z.strictObject({
      kind: z.enum(['lesson', 'manual']),
      /** The lesson's session; null for a column without a lesson. */
      sessionId: id.nullable(),
      /** The teacher's column; null for a lesson. */
      columnId: id.nullable(),
      lessonId: id.nullable(),
      /** The lesson's title, or the column's ("Контрольная"). */
      lessonTitle: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      /** When the teacher marked this column's grades as moved to eMaktab (W12). */
      emaktabAt: z.string().nullable().default(null),
    }),
  ),
  /** The eMaktab marks are kept on the platform only; a school computer shows none (W12). */
  emaktab: z.boolean().default(true),
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

/**
 * The teacher confirms or changes grades of a finished lesson (H10): a value sets the grade, null
 * takes it back to the suggestion.
 */
export const SetGradesSchema = z.strictObject({
  grades: z
    .array(z.strictObject({ studentId: id, value: GradeValueSchema.nullable() }))
    .min(1)
    .max(60),
});
export type SetGrades = z.infer<typeof SetGradesSchema>;

export const UpdateClassSettingsSchema = z.strictObject({ starsToGrade: z.boolean() });
export type UpdateClassSettings = z.infer<typeof UpdateClassSettingsSchema>;

// ---------- the journal by hand (W9)

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A column without a lesson: a test on paper, oral answers, homework. */
export const CreateJournalColumnSchema = z.strictObject({
  date: dateString,
  title: z.string().trim().min(1).max(60),
});
export type CreateJournalColumn = z.infer<typeof CreateJournalColumnSchema>;

/**
 * One cell set by hand: a grade 2–5 or none, "н" (absent) in a column without a lesson, a note.
 * A field left out is left as it is.
 */
export const SetJournalCellSchema = z.strictObject({
  column: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('lesson'), sessionId: id }),
    z.strictObject({ kind: z.literal('manual'), columnId: id }),
  ]),
  studentId: id,
  value: GradeValueSchema.nullable().optional(),
  absent: z.boolean().optional(),
  comment: z.string().trim().max(200).nullable().optional(),
});
export type SetJournalCell = z.infer<typeof SetJournalCellSchema>;

// ---------- moving grades to eMaktab (PLAN.md 5.4; W12)

export const SetEmaktabSchema = z.strictObject({
  column: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('lesson'), sessionId: id }),
    z.strictObject({ kind: z.literal('manual'), columnId: id }),
  ]),
  done: z.boolean(),
});
export type SetEmaktab = z.infer<typeof SetEmaktabSchema>;

/** eMaktab takes a grade for 72 hours from the lesson's date (CLAUDE.md §4.10). */
export const EMAKTAB_HOURS = 72;
/** Uzbekistan's time, all year: UTC+5. */
const TASHKENT_OFFSET_MS = 5 * 3_600_000;

/**
 * The last moment eMaktab still takes this day's grades: 72 hours from the start of the day in
 * Tashkent — the cautious reading of "72 hours from the lesson's date".
 */
export function emaktabUntil(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(
    Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - TASHKENT_OFFSET_MS + EMAKTAB_HOURS * 3_600_000,
  );
}

export interface EmaktabDue {
  /** The column in `journal.lessons`. */
  index: number;
  /** Grades in it to move. */
  grades: number;
  /** Whole hours left, at least 1 while there is time. */
  hoursLeft: number;
}

/** Columns with grades not yet marked as moved, while eMaktab still takes them, soonest first. */
export function emaktabDue(journal: Journal, now: Date): EmaktabDue[] {
  if (!journal.emaktab) return [];
  return journal.lessons
    .flatMap((lesson, index): EmaktabDue[] => {
      if (lesson.emaktabAt) return [];
      const left = emaktabUntil(lesson.date).getTime() - now.getTime();
      if (left <= 0) return [];
      const grades = journal.students.filter((s) => s.cells[index]?.grade != null).length;
      if (grades === 0) return [];
      return [{ index, grades, hoursLeft: Math.max(1, Math.floor(left / 3_600_000)) }];
    })
    .sort((a, b) => a.hoursLeft - b.hoursLeft);
}

/** For the teacher's home page: what is waiting to be moved, class by class (W12). */
export const EmaktabReminderSchema = z.strictObject({
  classId: id,
  className: z.string().min(1),
  lessonTitle: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grades: z.number().int().positive(),
  hoursLeft: z.number().int().positive(),
});
export type EmaktabReminder = z.infer<typeof EmaktabReminderSchema>;
export const EmaktabRemindersResponseSchema = z.strictObject({
  reminders: z.array(EmaktabReminderSchema),
});
export type EmaktabRemindersResponse = z.infer<typeof EmaktabRemindersResponseSchema>;
