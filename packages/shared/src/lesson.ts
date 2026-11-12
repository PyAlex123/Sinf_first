import { z } from 'zod';

/**
 * Lesson content format produced by `pnpm import:html` (STAGE1.md S1.2) and read by the server and the player.
 * Text content of lessons stays in Russian (it is the author's content); only the UI goes through i18n.
 */

// ---------- stages

/** Lesson stages in the author's scenarios, in their fixed order. */
export const STAGE_KEYS = [
  'greeting',
  'goal',
  'theory',
  'practice',
  'reflection',
  'summary',
] as const;
export const StageKeySchema = z.enum(STAGE_KEYS);
export type StageKey = z.infer<typeof StageKeySchema>;

/** Part of a stage, e.g. practice "9 + rest 4 + 9" → work 9, rest 4, work 9. */
export const StagePartSchema = z.strictObject({
  kind: z.enum(['work', 'rest']),
  minutes: z.number().int().positive(),
});
export type StagePart = z.infer<typeof StagePartSchema>;

export const StageSchema = z
  .strictObject({
    key: StageKeySchema,
    /** Label from the teacher's timeline, as written by the author ("приветствие", "выставка"). */
    title: z.string().min(1),
    startMin: z.number().int().nonnegative(),
    endMin: z.number().int().positive(),
    /** Where children look: at the projector or at their computer. `null` if the scenario does not say. */
    place: z.enum(['projector', 'computer']).nullable(),
    parts: z.array(StagePartSchema).min(1).optional(),
  })
  .refine((s) => s.endMin > s.startMin, { message: 'endMin must be greater than startMin' })
  .refine(
    (s) => !s.parts || s.parts.reduce((sum, p) => sum + p.minutes, 0) === s.endMin - s.startMin,
    {
      message: 'stage parts must add up to the stage duration',
    },
  );
export type Stage = z.infer<typeof StageSchema>;

// ---------- trainer levels (6 types from the author's file)

const stars = z.number().int().min(1).max(3);
const nonEmpty = z.string().min(1);

/** Fields shared by all level types. Teacher-facing fields (kid, hint, do, cap, tsay) are optional. */
const levelBase = {
  stars,
  /** Task text, read aloud by speech synthesis. */
  say: nonEmpty,
  /** Short task text for the child. */
  kid: nonEmpty.optional(),
  /** Hint for the teacher. */
  hint: nonEmpty.optional(),
  /** Steps the child performs, for the teacher. */
  do: z.array(nonEmpty).optional(),
  /** Caption for the teacher's scenario. */
  cap: nonEmpty.optional(),
  /** Teacher's line. */
  tsay: nonEmpty.optional(),
  /** Message shown in the "Well done!" window. */
  done: nonEmpty.optional(),
  /** PICS key shown in the "Well done!" window. */
  pic: nonEmpty.optional(),
  /** PICS keys shown above the task, with an arrow in direction `dir`. */
  show: z.array(nonEmpty).min(1).optional(),
  dir: z.enum(['before', 'after', 'none']).optional(),
  /** A row of cells shown above the task; `rowhl` is the highlighted index. */
  row: z.array(nonEmpty).min(1).optional(),
  rowhl: z.number().int().nonnegative().optional(),
  /** Values are letters of ABC and are drawn in their colors. */
  abc: z.boolean().optional(),
};

export const StoryLevelSchema = z.strictObject({
  ...levelBase,
  type: z.literal('story'),
  /** PICS keys in the correct order. */
  cards: z.array(nonEmpty).min(2),
});

export const PickOptionSchema = z.union([
  z.tuple([z.literal('pic'), nonEmpty]),
  z.tuple([z.literal('txt'), nonEmpty]),
  /** Index into ABC. */
  z.tuple([z.literal('abc'), z.number().int().nonnegative()]),
]);
export type PickOption = z.infer<typeof PickOptionSchema>;

export const PickLevelSchema = z
  .strictObject({
    ...levelBase,
    type: z.literal('pick'),
    opts: z.array(PickOptionSchema).min(2),
    /** Index of the correct option. */
    ok: z.number().int().nonnegative(),
  })
  .refine((l) => l.ok < l.opts.length, { message: 'ok must point to an option' });

export const TrainLevelSchema = z
  .strictObject({
    ...levelBase,
    type: z.literal('train'),
    /** Wagons; a value starting with "?" is a gap the child fills. */
    seq: z.array(nonEmpty).min(2),
    /** Distractor tiles. */
    extra: z.array(nonEmpty),
  })
  .refine((l) => l.seq.some((v) => v.startsWith('?') && v.length > 1), {
    message: 'train needs at least one gap',
  });

export const NbrLevelSchema = z.strictObject({
  ...levelBase,
  type: z.literal('nbr'),
  mid: nonEmpty,
  before: nonEmpty,
  after: nonEmpty,
  extra: z.array(nonEmpty),
  /** Labels of the two gaps, default "перед" / "после". */
  labs: z.tuple([nonEmpty, nonEmpty]).optional(),
});

export const WordLevelSchema = z
  .strictObject({
    ...levelBase,
    type: z.literal('word'),
    letters: z.array(nonEmpty).min(1),
    word: nonEmpty,
  })
  .refine((l) => [...l.word].sort().join('') === [...l.letters].sort().join(''), {
    message: 'letters must be an anagram of word',
  });

export const GroupsLevelSchema = z.strictObject({
  ...levelBase,
  type: z.literal('groups'),
  groups: z
    .array(
      z.strictObject({
        lab: nonEmpty,
        color: nonEmpty,
        keys: z.array(nonEmpty).min(1),
      }),
    )
    .min(2),
});

export type StoryLevel = z.infer<typeof StoryLevelSchema>;
export type PickLevel = z.infer<typeof PickLevelSchema>;
export type TrainLevel = z.infer<typeof TrainLevelSchema>;
export type NbrLevel = z.infer<typeof NbrLevelSchema>;
export type WordLevel = z.infer<typeof WordLevelSchema>;
export type GroupsLevel = z.infer<typeof GroupsLevelSchema>;

export const GAME_TYPES = ['story', 'pick', 'train', 'nbr', 'word', 'groups'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const GameLevelSchema = z.discriminatedUnion('type', [
  StoryLevelSchema,
  PickLevelSchema,
  TrainLevelSchema,
  NbrLevelSchema,
  WordLevelSchema,
  GroupsLevelSchema,
]);
export type GameLevel = z.infer<typeof GameLevelSchema>;

// ---------- screens

/** Sanitized HTML of a slide (author's markup and CSS classes, inline SVG, images as /content/… URLs). */
const html = z.string().min(1);
/** Sanitized inline SVG markup. */
const svg = z.string().startsWith('<svg');

export const SlideScreenSchema = z.strictObject({
  kind: z.literal('slide'),
  stage: StageKeySchema,
  /** CSS class of the author's slide: `title`, `text` or `text wide`. */
  layout: z.enum(['title', 'text', 'text wide']),
  html,
});

/** Step-by-step practice in Paint. */
export const StepScreenSchema = z.strictObject({
  kind: z.literal('step'),
  stage: StageKeySchema,
  /** Step number from "Шаг N", `null` if the slide has none. */
  step: z.number().int().positive().nullable(),
  /** Difficulty in stars, `free` for a free task, `null` if not marked. */
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('free')]).nullable(),
  html,
});

/** "Type the word" task. */
export const TypeScreenSchema = z.strictObject({
  kind: z.literal('type'),
  stage: StageKeySchema,
  question: nonEmpty,
  pic: svg,
  word: nonEmpty,
  /** Number of this task among the lesson's typing tasks: `n` of `of`. */
  n: z.number().int().positive(),
  of: z.number().int().positive(),
});

/** Trainer level. */
export const GameScreenSchema = z.strictObject({
  kind: z.literal('game'),
  stage: StageKeySchema,
  /** Task number shown to the child ("Задание n"). */
  n: z.number().int().positive(),
  level: GameLevelSchema,
});

export const ScreenSchema = z.discriminatedUnion('kind', [
  SlideScreenSchema,
  StepScreenSchema,
  TypeScreenSchema,
  GameScreenSchema,
]);
export type Screen = z.infer<typeof ScreenSchema>;
export type ScreenKind = Screen['kind'];
export const SCREEN_KINDS = [
  'slide',
  'step',
  'type',
  'game',
] as const satisfies readonly ScreenKind[];

// ---------- lesson and course

export const LessonGroupSchema = z.enum(['gos', 'krujok']);
export type LessonGroup = z.infer<typeof LessonGroupSchema>;

const contentUrl = z.string().startsWith('/content/');

export const LessonSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    group: LessonGroupSchema,
    /** Lesson number in the curriculum (КТП row). */
    num: z.number().int().positive(),
    title: nonEmpty,
    sub: z.string(),
    icon: svg,
    stages: z.array(StageSchema).min(1),
    screens: z.array(ScreenSchema).min(1),
    /** URL of the sanitized teacher scenario (standalone HTML document). */
    teacherScenario: contentUrl,
    /** Every media URL the lesson's screens reference (and nothing else), for preloading and caching. */
    media: z.array(contentUrl),
  })
  .superRefine((lesson, ctx) => {
    const keys = new Set(lesson.stages.map((s) => s.key));
    lesson.screens.forEach((screen, i) => {
      if (!keys.has(screen.stage)) {
        ctx.addIssue({
          code: 'custom',
          message: `stage "${screen.stage}" is not in lesson stages`,
          path: ['screens', i, 'stage'],
        });
      }
    });
    lesson.stages.forEach((stage, i) => {
      const prev = lesson.stages[i - 1];
      if (prev && prev.endMin !== stage.startMin) {
        ctx.addIssue({
          code: 'custom',
          message: 'stages must follow each other without gaps',
          path: ['stages', i],
        });
      }
    });
  });
export type Lesson = z.infer<typeof LessonSchema>;

export const LessonSummarySchema = z.strictObject({
  id: LessonSchema.shape.id,
  group: LessonGroupSchema,
  num: z.number().int().positive(),
  title: nonEmpty,
  sub: z.string(),
  icon: svg,
  screens: z.number().int().positive(),
});
export type LessonSummary = z.infer<typeof LessonSummarySchema>;

/** `course.json`: index of an imported course and data shared by all its lessons. */
export const CourseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: nonEmpty,
    lessons: z.array(LessonSummarySchema).min(1),
    /** Letters used by `abc` levels and their colors (same length). */
    abc: z.array(nonEmpty),
    abcColors: z.array(nonEmpty),
    /** Shared SVG definitions (patterns, gradients, clip paths) referenced by slides via `url(#id)`. */
    svgDefs: z.string(),
    /** URL of the author's lesson stylesheet. */
    styles: contentUrl,
    /** URL of `pics.json`: PICS key → inline SVG. */
    pics: contentUrl,
  })
  .refine((c) => c.abc.length === c.abcColors.length, {
    message: 'abc and abcColors must have the same length',
  });
export type Course = z.infer<typeof CourseSchema>;

export const PicsSchema = z.record(z.string().regex(/^[A-Za-z0-9_]+$/), svg);
export type Pics = z.infer<typeof PicsSchema>;

/** URL prefix under which the server serves `content/<courseId>/…`. */
export const CONTENT_URL_PREFIX = '/content';

export function courseUrl(courseId: string, path: string): string {
  return `${CONTENT_URL_PREFIX}/${courseId}/${path}`;
}
