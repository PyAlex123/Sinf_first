import { z } from 'zod';
import {
  STAGE_KEYS,
  StageKeySchema,
  type Lesson,
  type Screen,
  type Stage,
  type StageKey,
} from './lesson.js';
import { PracticeTaskSchema } from './practice.js';
import type { Quiz, QuizQuestion } from './quiz.js';

/**
 * A teacher's own lesson (CLAUDE.md §4.3; PLAN.md 3.1; stage 4, W1; ADR-019).
 *
 * The author's lessons are files made by the import (ADR-005); a teacher's lesson is a document in
 * the database, edited in the constructor. Both are played by the same engine and the same player:
 * `authoredToLesson` turns the document into the author's format — stages with their minutes, and
 * screens with HTML made here from plain text, every character escaped. A teacher types text, never
 * markup.
 *
 * The stages are the author's six keys in their fixed order (greeting, goal, theory, practice,
 * reflection, summary): the engine knows the practice and the reflection by their keys (screenshots
 * before the practice ends, the live quiz in the reflection). A teacher chooses which of them the
 * lesson has, what they are called, how long they are and where the class looks.
 */

const text = (max: number) => z.string().max(max);
const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

// ---------- pictures and files of a lesson

/** Kinds of files a lesson may hold: pictures for slides, templates for the practice. */
export const ASSET_EXTENSIONS = [
  'webp',
  'png',
  'jpg',
  'docx',
  'xlsx',
  'pptx',
  'txt',
  'html',
] as const;
export const AssetExtensionSchema = z.enum(ASSET_EXTENSIONS);
export type AssetExtension = z.infer<typeof AssetExtensionSchema>;
export const IMAGE_ASSET_EXTENSIONS: readonly AssetExtension[] = ['webp', 'png', 'jpg'];
/** A slide picture is made small in the browser (CLAUDE.md §3.1: ≤ 150 KB); a little room is left. */
export const MAX_IMAGE_ASSET_BYTES = 400 * 1024;
/** A practice template is a document, not a film. */
export const MAX_FILE_ASSET_BYTES = 10 * 1024 * 1024;

/** Where a lesson file is served: under /content, like the author's media, named by its content. */
export function assetUrl(sha: string, ext: AssetExtension): string {
  return `/content/_assets/${sha}.${ext}`;
}

export const ImageAssetSchema = z.strictObject({
  sha: sha256,
  ext: z.enum(['webp', 'png', 'jpg']),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
});
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

export const AssetUploadResponseSchema = z.strictObject({
  sha: sha256,
  ext: AssetExtensionSchema,
  size: z.number().int().nonnegative(),
  url: z.string().startsWith('/content/_assets/'),
});
export type AssetUploadResponse = z.infer<typeof AssetUploadResponseSchema>;

// ---------- blocks

/** A slide: a title, a few lines, a list, a picture — whichever the teacher fills. */
export const SlideBlockSchema = z.strictObject({
  id: blockId,
  kind: z.literal('slide'),
  title: text(120).default(''),
  text: text(1500).default(''),
  bullets: z.array(text(200)).max(12).default([]),
  image: ImageAssetSchema.nullable().default(null),
});
export type SlideBlock = z.infer<typeof SlideBlockSchema>;

/**
 * A question of the lesson's test (PLAN.md 3.5; W4): one right choice, several, or a typed answer.
 * The questions of a stage, one after another, are the test; the stage's minutes are its time.
 */
export const QuestionBlockSchema = z.strictObject({
  id: blockId,
  kind: z.literal('question'),
  text: text(300).default(''),
  mode: z.enum(['single', 'multi', 'input']).default('single'),
  options: z
    .array(z.strictObject({ text: text(120), correct: z.boolean().default(false) }))
    .max(6)
    .default([]),
  /** Accepted forms of a typed answer: "Enter", "энтер". */
  answers: z.array(text(60)).max(10).default([]),
});
export type QuestionBlock = z.infer<typeof QuestionBlockSchema>;

export const AuthoredBlockSchema = z.discriminatedUnion('kind', [
  SlideBlockSchema,
  QuestionBlockSchema,
]);
export type AuthoredBlock = z.infer<typeof AuthoredBlockSchema>;

// ---------- stages and the document

export const AuthoredStageSchema = z.strictObject({
  key: StageKeySchema,
  title: z.string().trim().min(1).max(40),
  minutes: z.number().int().min(1).max(90),
  /** Where the class looks: at the projector (the teacher drives) or at their own computer. */
  place: z.enum(['projector', 'computer']),
  blocks: z.array(AuthoredBlockSchema).max(60).default([]),
});
export type AuthoredStage = z.infer<typeof AuthoredStageSchema>;

/**
 * A question of a teacher's live quiz (W5): text answers, two to four. Kept as the teacher left it —
 * an unfinished question is saved too, and simply not asked (`authoredQuiz`).
 */
export const AuthoredQuizQuestionSchema = z.strictObject({
  text: text(200).default(''),
  options: z.array(text(60)).max(4).default(['', '']),
  correct: z.number().int().min(0).max(3).default(0),
  limitSec: z.number().int().min(5).max(120).default(20),
});
export type AuthoredQuizQuestion = z.infer<typeof AuthoredQuizQuestionSchema>;

/** The live quiz of a teacher's lesson: it runs in the reflection stage, as the author's. */
export const AuthoredQuizSchema = z.strictObject({
  questions: z.array(AuthoredQuizQuestionSchema).max(20),
});
export type AuthoredQuiz = z.infer<typeof AuthoredQuizSchema>;

/** Why a quiz question will not be asked; null when it will. */
export function quizQuestionProblem(
  q: AuthoredQuizQuestion,
): 'text' | 'options' | 'correct' | null {
  if (!q.text.trim()) return 'text';
  if (q.options.filter((o) => o.trim()).length < 2) return 'options';
  if (!q.options[q.correct]?.trim()) return 'correct';
  return null;
}

/** A school lesson is 45 minutes; a double one is 90. */
export const MAX_LESSON_MINUTES = 90;

export const AuthoredLessonDocSchema = z
  .strictObject({
    stages: z.array(AuthoredStageSchema).min(1).max(STAGE_KEYS.length),
    quiz: AuthoredQuizSchema.nullable().default(null),
    practice: PracticeTaskSchema.nullable().default(null),
  })
  .superRefine((doc, ctx) => {
    const order = doc.stages.map((s) => STAGE_KEYS.indexOf(s.key));
    if (order.some((v, i) => i > 0 && v <= (order[i - 1] ?? -1))) {
      ctx.addIssue({
        code: 'custom',
        message: 'stages go in their fixed order, each once',
        path: ['stages'],
      });
    }
    const minutes = doc.stages.reduce((sum, s) => sum + s.minutes, 0);
    if (minutes > MAX_LESSON_MINUTES) {
      ctx.addIssue({
        code: 'custom',
        message: `a lesson is at most ${MAX_LESSON_MINUTES} minutes`,
        path: ['stages'],
      });
    }
    const ids = doc.stages.flatMap((s) => s.blocks.map((b) => b.id));
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'block ids must be unique', path: ['stages'] });
    }
  });
export type AuthoredLessonDoc = z.infer<typeof AuthoredLessonDocSchema>;

// ---------- the lesson as the API carries it

export const LessonVisibilitySchema = z.enum(['private', 'school', 'public']);
export type LessonVisibility = z.infer<typeof LessonVisibilitySchema>;

export const AuthoredLessonMetaSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  grade: z.number().int().min(1).max(11),
  topic: z.string().trim().max(200).default(''),
  visibility: LessonVisibilitySchema.default('private'),
});
export type AuthoredLessonMeta = z.infer<typeof AuthoredLessonMetaSchema>;

/** Ids of a teacher's lessons look like the author's (`^[a-z0-9-]+$`) and never collide with them. */
export const AUTHORED_ID_PREFIX = 'u-';
export const AuthoredLessonIdSchema = z.string().regex(/^u-[0-9a-f]{32}$/);
export const isAuthoredLessonId = (id: string): boolean =>
  AuthoredLessonIdSchema.safeParse(id).success;

export const AuthoredLessonSummarySchema = z.strictObject({
  id: AuthoredLessonIdSchema,
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  title: z.string().min(1),
  grade: z.number().int(),
  topic: z.string(),
  visibility: LessonVisibilitySchema,
  minutes: z.number().int().nonnegative(),
  screens: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  updatedAt: z.string().min(1),
  /** The one asking may change it: their own lesson, on the platform (ADR-019). */
  editable: z.boolean(),
});
export type AuthoredLessonSummary = z.infer<typeof AuthoredLessonSummarySchema>;

export const AuthoredLessonSchema = AuthoredLessonSummarySchema.extend({
  doc: AuthoredLessonDocSchema,
});
export type AuthoredLesson = z.infer<typeof AuthoredLessonSchema>;

export const AuthoredLessonListResponseSchema = z.strictObject({
  lessons: z.array(AuthoredLessonSummarySchema),
});
export type AuthoredLessonListResponse = z.infer<typeof AuthoredLessonListResponseSchema>;

export const CreateAuthoredLessonSchema = AuthoredLessonMetaSchema.extend({
  /** `standard45`: the four stages of CLAUDE.md §4.3, each with its first slide; `empty`: theory only. */
  template: z.enum(['standard45', 'empty']).default('standard45'),
});
export type CreateAuthoredLesson = z.infer<typeof CreateAuthoredLessonSchema>;

/** A save from the constructor; `version` is the one it was made from (two tabs must not overwrite). */
export const UpdateAuthoredLessonSchema = AuthoredLessonMetaSchema.extend({
  doc: AuthoredLessonDocSchema,
  version: z.number().int().positive(),
});
export type UpdateAuthoredLesson = z.infer<typeof UpdateAuthoredLessonSchema>;

// ---------- the template of CLAUDE.md §4.3

let counter = 0;
/** A short id for a new block; unique enough inside one lesson. */
export function newBlockId(): string {
  counter = (counter + 1) % 1296;
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const STAGE_TITLES: Record<StageKey, string> = {
  greeting: 'Приветствие',
  goal: 'Цель урока',
  theory: 'Теория',
  practice: 'Практика',
  reflection: 'Викторина',
  summary: 'Итоги',
};

export function defaultStage(key: StageKey, minutes: number): AuthoredStage {
  return {
    key,
    title: STAGE_TITLES[key],
    minutes,
    place: key === 'practice' ? 'computer' : 'projector',
    blocks: [],
  };
}

function cover(title: string, line = ''): SlideBlock {
  return { id: newBlockId(), kind: 'slide', title, text: line, bullets: [], image: null };
}

/** Theory 10, practice 25, quiz 7, summary 3 (CLAUDE.md §4.3), each stage with its first slide. */
export function standardLessonDoc(title: string): AuthoredLessonDoc {
  const stages: AuthoredStage[] = [
    { ...defaultStage('theory', 10), blocks: [cover(title)] },
    { ...defaultStage('practice', 25), blocks: [cover('Практика', 'Что сделать на компьютере')] },
    { ...defaultStage('reflection', 7), blocks: [cover('Викторина', 'Отвечаем на вопросы')] },
    { ...defaultStage('summary', 3), blocks: [cover('Итоги урока')] },
  ];
  return { stages, quiz: null, practice: null };
}

export function emptyLessonDoc(title: string): AuthoredLessonDoc {
  return {
    stages: [{ ...defaultStage('theory', 45), blocks: [cover(title)] }],
    quiz: null,
    practice: null,
  };
}

// ---------- into the author's format

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/** Text as HTML text: nothing a teacher types becomes markup. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

const paragraphs = (value: string): string =>
  value
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');

function figure(image: ImageAsset): string {
  // The author's slides draw pictures inside an SVG frame (lesson.css styles `.fig-svg`).
  return (
    `<div class="s-fig"><svg viewBox="0 0 ${image.width} ${image.height}" xmlns="http://www.w3.org/2000/svg" class="fig-svg shot">` +
    `<image x="0" y="0" width="${image.width}" height="${image.height}" href="${assetUrl(image.sha, image.ext)}"></image></svg></div>`
  );
}

/** One slide block as an author's slide screen. */
export function slideScreen(
  stage: AuthoredStage,
  block: SlideBlock,
): Extract<Screen, { kind: 'slide' }> {
  const bullets = block.bullets.map((b) => b.trim()).filter(Boolean);
  const body = block.text.trim();
  const title = block.title.trim();
  // A page of a PDF (W3): the picture is the slide, as large as the screen allows.
  if (!title && !body && bullets.length === 0 && block.image) {
    const image = block.image;
    return {
      kind: 'slide',
      stage: stage.key,
      layout: 'text wide',
      html:
        `<div class="s-fig" style="width:min(94vw,150vh);max-width:none">` +
        `<svg viewBox="0 0 ${image.width} ${image.height}" xmlns="http://www.w3.org/2000/svg" class="fig-svg shot" style="max-height:82vh">` +
        `<image x="0" y="0" width="${image.width}" height="${image.height}" href="${assetUrl(image.sha, image.ext)}"></image></svg></div>`,
    };
  }
  // Only a title (and perhaps a picture): a title slide, as the author's first slides.
  if (!body && bullets.length === 0) {
    return {
      kind: 'slide',
      stage: stage.key,
      layout: 'title',
      html:
        `<div class="s-title"><div class="s-kicker">${escapeHtml(stage.title)}</div>` +
        `<h1>${escapeHtml(title || stage.title)}</h1></div>` +
        (block.image ? figure(block.image) : ''),
    };
  }
  const list = bullets.length
    ? `<ul class="s-list">${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
    : '';
  return {
    kind: 'slide',
    stage: stage.key,
    layout: block.image ? 'text' : 'text wide',
    html:
      `<div class="s-text"><div class="s-stage">${escapeHtml(stage.title)}</div>` +
      (title ? `<h2>${escapeHtml(title)}</h2>` : '') +
      paragraphs(body) +
      list +
      `</div>` +
      (block.image ? figure(block.image) : ''),
  };
}

/** A stage without blocks still needs a screen: the class sees its name. */
function stageCover(stage: AuthoredStage): Screen {
  return slideScreen(stage, {
    id: 'cover',
    kind: 'slide',
    title: stage.title,
    text: '',
    bullets: [],
    image: null,
  });
}

export const AUTHORED_ICON =
  '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="150" fill="#e8f0fe"></rect>' +
  '<rect x="52" y="22" width="96" height="106" rx="8" fill="#fff" stroke="#1e63d6" stroke-width="4"></rect>' +
  '<rect x="66" y="40" width="68" height="10" rx="4" fill="#1e63d6"></rect>' +
  '<rect x="66" y="60" width="68" height="6" rx="3" fill="#9fb3d1"></rect>' +
  '<rect x="66" y="74" width="56" height="6" rx="3" fill="#9fb3d1"></rect>' +
  '<rect x="66" y="88" width="62" height="6" rx="3" fill="#9fb3d1"></rect></svg>';

export interface AuthoredSource {
  id: string;
  title: string;
  topic: string;
  doc: AuthoredLessonDoc;
}

/** Why a question cannot be asked yet; null when it can. The constructor shows it beside the block. */
export function questionProblem(
  q: QuestionBlock,
): 'text' | 'options' | 'correct' | 'answers' | null {
  if (!q.text.trim()) return 'text';
  if (q.mode === 'input') return q.answers.some((a) => a.trim()) ? null : 'answers';
  const options = q.options.filter((o) => o.text.trim());
  if (options.length < 2) return 'options';
  const right = options.filter((o) => o.correct).length;
  if (right === 0 || (q.mode === 'single' && right > 1)) return 'correct';
  return null;
}

/** A question as a screen; one not finished yet is shown as a slide saying so, never half-asked. */
function questionScreen(stage: AuthoredStage, q: QuestionBlock, n: number, of: number): Screen {
  if (questionProblem(q)) {
    return slideScreen(stage, {
      id: q.id,
      kind: 'slide',
      title: q.text.trim() || stage.title,
      text: '',
      bullets: [],
      image: null,
    });
  }
  const options = q.options.filter((o) => o.text.trim());
  return {
    kind: 'question',
    stage: stage.key,
    n,
    of,
    text: q.text.trim(),
    mode: q.mode,
    options: q.mode === 'input' ? [] : options.map((o) => o.text.trim()),
    correct: q.mode === 'input' ? [] : options.flatMap((o, i) => (o.correct ? [i] : [])),
    answers: q.mode === 'input' ? q.answers.map((a) => a.trim()).filter(Boolean) : [],
  };
}

function screensOf(stage: AuthoredStage, numbering: { n: number; of: number }): Screen[] {
  const out: Screen[] = stage.blocks.map((block) => {
    if (block.kind === 'slide') return slideScreen(stage, block);
    numbering.n += 1;
    return questionScreen(stage, block, numbering.n, numbering.of);
  });
  return out.length > 0 ? out : [stageCover(stage)];
}

/**
 * The teacher's document in the author's format: what the engine, the player, the results and the
 * school computer already understand (ADR-019).
 */
export function authoredToLesson(source: AuthoredSource): Lesson {
  let at = 0;
  const stages: Stage[] = source.doc.stages.map((s) => {
    const stage: Stage = {
      key: s.key,
      title: s.title,
      startMin: at,
      endMin: at + s.minutes,
      place: s.place,
    };
    at += s.minutes;
    return stage;
  });
  const of = source.doc.stages.reduce(
    (sum, s) => sum + s.blocks.filter((b) => b.kind === 'question').length,
    0,
  );
  const numbering = { n: 0, of: Math.max(1, of) };
  const screens = source.doc.stages.flatMap((s) => screensOf(s, numbering));
  const media = new Set<string>();
  for (const s of source.doc.stages) {
    for (const b of s.blocks)
      if (b.kind === 'slide' && b.image) media.add(assetUrl(b.image.sha, b.image.ext));
  }
  return {
    id: source.id,
    group: 'own',
    num: 1,
    title: source.title,
    sub: source.topic,
    icon: AUTHORED_ICON,
    stages,
    screens,
    teacherScenario: null,
    media: [...media],
  };
}

/** The live quiz of a teacher's lesson in the author's format: the finished questions only. */
export function authoredQuiz(source: AuthoredSource): Quiz | null {
  const questions: QuizQuestion[] = [];
  for (const q of source.doc.quiz?.questions ?? []) {
    if (quizQuestionProblem(q)) continue;
    const kept = q.options.map((text, i) => ({ text: text.trim(), i })).filter((o) => o.text);
    questions.push({
      text: q.text.trim(),
      say: q.text.trim(),
      options: kept.map((o) => ({ text: o.text })),
      correct: kept.findIndex((o) => o.i === q.correct),
      limitSec: q.limitSec,
    });
  }
  return questions.length > 0 ? { lessonId: source.id, questions } : null;
}

/** Minutes and screens, for lists. */
export function authoredCounts(doc: AuthoredLessonDoc): { minutes: number; screens: number } {
  return {
    minutes: doc.stages.reduce((sum, s) => sum + s.minutes, 0),
    screens: doc.stages.reduce((sum, s) => sum + Math.max(1, s.blocks.length), 0),
  };
}

// ---------- the platform → a school computer (ADR-019)

export const SyncLessonListSchema = z.strictObject({
  lessons: z.array(
    z.strictObject({
      id: AuthoredLessonIdSchema,
      version: z.number().int().positive(),
      updatedAt: z.string().min(1),
    }),
  ),
});
export type SyncLessonList = z.infer<typeof SyncLessonListSchema>;

/** One lesson of the school's teachers as the school computer keeps it, read-only. */
export const SyncAuthoredLessonSchema = z.strictObject({
  id: AuthoredLessonIdSchema,
  ownerId: z.string().min(1),
  title: z.string().min(1),
  grade: z.number().int(),
  topic: z.string(),
  visibility: LessonVisibilitySchema,
  doc: AuthoredLessonDocSchema,
  version: z.number().int().positive(),
  sourceId: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type SyncAuthoredLesson = z.infer<typeof SyncAuthoredLessonSchema>;

/** Every lesson file a document names: slide pictures and the practice template. */
export function lessonAssetFiles(doc: AuthoredLessonDoc): string[] {
  const files = new Set<string>();
  for (const s of doc.stages) {
    for (const b of s.blocks)
      if (b.kind === 'slide' && b.image) files.add(`${b.image.sha}.${b.image.ext}`);
  }
  const template = doc.practice?.template;
  if (template && /^[0-9a-f]{64}\.[a-z]+$/.test(template)) files.add(template);
  return [...files];
}
