import { z } from 'zod';

/**
 * The live quiz at the end of a lesson (STAGE1 S1.12, docs/stage1-architecture.md §10).
 *
 * The questions live beside the lesson, in `content/<course>/quizzes/<lessonId>.json`, written by
 * hand rather than by the import — the import only ever rewrites its own folders, so these files
 * survive a re-import, and the content manifest (S2.5) carries them to school computers along with
 * everything else.
 *
 * A first grader reads badly, so an answer is a picture; the colour and the letter beside it come
 * from the option's position and are not stored, which keeps the files short and every quiz looking
 * the same. `text` is for the few questions where the answer is a number.
 */

export const QUIZ_OPTION_LETTERS = ['А', 'Б', 'В', 'Г'] as const;
/** Named here, drawn in the screens: the same four colours on the projector and in a child's hand. */
export const QUIZ_OPTION_COLORS = ['red', 'blue', 'yellow', 'green'] as const;
export const MAX_QUIZ_OPTIONS = QUIZ_OPTION_LETTERS.length;
export const DEFAULT_QUIZ_LIMIT_SEC = 20;

/** Points for the fastest answer, and for one that only just made it. */
export const QUIZ_POINTS_BASE = 500;
export const QUIZ_POINTS_SPEED = 500;

export const QuizOptionSchema = z
  .strictObject({
    /** PICS key, as everywhere else in the lesson content (ADR-005). */
    pic: z.string().min(1).optional(),
    /** A number or a very short word, when a picture would say less than the word does. */
    text: z.string().min(1).max(16).optional(),
  })
  .refine((o) => Boolean(o.pic) !== Boolean(o.text), {
    message: 'An option is either a picture or a text, not both and not neither',
  });
export type QuizOption = z.infer<typeof QuizOptionSchema>;

export const QuizQuestionSchema = z
  .strictObject({
    /** Shown on the projector and on the child's screen. */
    text: z.string().min(1),
    /** Read aloud; the child presses 🔊 to hear it again. */
    say: z.string().min(1),
    options: z.array(QuizOptionSchema).min(2).max(MAX_QUIZ_OPTIONS),
    correct: z.number().int().nonnegative(),
    limitSec: z.number().int().min(5).max(120).default(DEFAULT_QUIZ_LIMIT_SEC),
  })
  .refine((q) => q.correct < q.options.length, { message: 'correct points past the last option' });
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizSchema = z.strictObject({
  lessonId: z.string().min(1),
  questions: z.array(QuizQuestionSchema).min(1).max(20),
});
export type Quiz = z.infer<typeof QuizSchema>;

/** Most lessons have no quiz, so the answer is `{ quiz: null }` rather than an error. */
export const QuizResponseSchema = z.strictObject({ quiz: QuizSchema.nullable() });
export type QuizResponse = z.infer<typeof QuizResponseSchema>;

/**
 * Points for one answer: a wrong one is worth nothing, a right one is worth more the sooner it came
 * (docs/stage1-architecture.md §10). Answering instantly is worth about 1000, answering as the time
 * runs out is worth 500 — so speed matters, but knowing the answer matters twice as much.
 */
export function scoreAnswer(correct: boolean, timeMs: number, limitMs: number): number {
  if (!correct || limitMs <= 0) return 0;
  const spent = Math.min(Math.max(timeMs, 0), limitMs);
  return Math.round(QUIZ_POINTS_BASE + QUIZ_POINTS_SPEED * (1 - spent / limitMs));
}
