import { z } from 'zod';
import { PracticeCheckStateSchema } from './practice.js';

/**
 * Realtime protocol between the server and the lesson clients (teacher, student, projector) — ADR-006,
 * docs/stage1-architecture.md §5. Every message carries `v`; unknown messages are ignored by both sides.
 * Synchronous presentation, locks, participant presence and student login (S1.7); stage timer and quiz
 * messages arrive with S1.8 / S1.12.
 */

/** Version of the realtime protocol (CLAUDE.md §5.6). */
export const PROTOCOL_VERSION = 1;
const v = z.literal(PROTOCOL_VERSION);
const id = z.string().min(1);
const screenIndex = z.number().int().nonnegative();
const serverTime = z.number();

export const RoleSchema = z.enum(['teacher', 'student', 'projector']);
export type Role = z.infer<typeof RoleSchema>;

/** `presentation`: everybody sees the teacher's screen; `free`: students move through screens themselves. */
export const SessionModeSchema = z.enum(['presentation', 'free']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const LockTargetsSchema = z.union([z.literal('all'), z.array(id).min(1)]);
export type LockTargets = z.infer<typeof LockTargetsSchema>;

/** A link the teacher sends to the class (W6): a web address and nothing else. */
export const LinkSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'only http and https links');

/** Why a screenshot is taken (CLAUDE.md §4.8, §6 Screenshot.kind). */
export const ScreenshotReasonSchema = z.enum(['manual', 'before_end', 'stage_end']);
export type ScreenshotReason = z.infer<typeof ScreenshotReasonSchema>;

/**
 * A screen thumbnail as base64 JPEG (stage 3, H5): 320 px, at most 30 KB (CLAUDE.md §3.1), which is
 * about 40 000 base64 characters; the limit leaves a margin and still fits one frame.
 */
export const MAX_THUMB_BASE64 = 48_000;

const LockTextSchema = z.string().max(200);

export const LockStateSchema = z.strictObject({
  all: z.strictObject({ text: LockTextSchema }).nullable(),
  byParticipant: z.record(id, z.strictObject({ text: LockTextSchema })),
});
export type LockState = z.infer<typeof LockStateSchema>;

/**
 * A connected (or recently connected) lesson participant. Until student login arrives (S1.7) participants are
 * anonymous: `studentId` is null and the UI shows "Student N" from `number`.
 */
export const ParticipantSchema = z.strictObject({
  id,
  number: z.number().int().positive(),
  studentId: id.nullable(),
  /** "Фамилия Имя" for a logged-in student; null for anonymous participants. */
  name: z.string().nullable(),
  online: z.boolean(),
  screenIndex,
  stars: z.number().int().nonnegative(),
  /** Screens already rewarded with stars (each screen counts once). */
  doneScreens: z.array(screenIndex),
  /**
   * Steps of the Paint practice the child has marked as done (S1.11). Screen indexes, in the order
   * they were pressed. `default` keeps snapshots written before this field readable.
   */
  steps: z.array(screenIndex).default([]),
  /** Stars the teacher gave for the drawing itself, 1–3; null while nothing is given (S1.11). */
  practiceStars: z.number().int().min(1).max(3).nullable().default(null),
  hand: z.boolean(),
  /** Tab hidden or another window focused (`visibilitychange`). */
  hidden: z.boolean(),
  fullscreen: z.boolean(),
  /**
   * How many times the student left the lesson during this session (tab hidden or full screen left).
   * A momentary flag is missed while the teacher looks at the class, so the count stays until the end.
   * `default` keeps snapshots written before this field readable (`sessions.state_json`).
   */
  escapes: z.number().int().nonnegative().default(0),
  /**
   * Played by the server for a demo (S1.15), not a child at a computer. `default` keeps older
   * snapshots readable.
   */
  virtual: z.boolean().default(false),
  /**
   * The classroom computer the child sits at, "ПК-05" (stage 3). Set only for the classroom app,
   * where "Attention!" really locks keyboard and mouse (H4); null in a browser.
   */
  pc: z.string().nullable().default(null),
  /**
   * The child's practice file as last checked (H16): the tile shows "3/5", the child their
   * check-list. Null until the first save of a lesson with a practice task.
   */
  check: PracticeCheckStateSchema.nullable().default(null),
  lastSeenAt: serverTime,
});
export type Participant = z.infer<typeof ParticipantSchema>;

/** Where the lesson is in its scenario (STAGE1 S1.8). Times are server milliseconds. */
export const StageStateSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  /** When the current stage started (after "+5 min" and pauses this is a virtual start). */
  startedAt: serverTime,
  /** Set while the timer is on hold. */
  pausedAt: serverTime.nullable(),
  /** Extra time added with "+5 min", in lesson milliseconds. */
  extraMs: z.number().nonnegative(),
  /** Countdown before the automatic switch is running until this moment (server time). */
  countdownUntil: serverTime.nullable(),
  /** Part of a split stage: practice is work → rest → work. */
  part: z.enum(['work', 'rest']).nullable(),
  /**
   * The practice's screenshots before its end have been asked for (stage 3, H5): once per stage,
   * so a teacher pressing "+5 min" does not get a second round. `default` keeps old snapshots readable.
   */
  shotRequested: z.boolean().default(false),
});
export type StageState = z.infer<typeof StageStateSchema>;

/**
 * The live quiz while it runs (S1.12). Null between lessons and whenever no quiz is on; a snapshot
 * written before this existed reads as null, so old sessions still open.
 */
export const QuizPhaseSchema = z.enum(['question', 'reveal', 'leaderboard', 'podium']);
export type QuizPhase = z.infer<typeof QuizPhaseSchema>;

export const QuizAnswerSchema = z.strictObject({
  optionIndex: z.number().int().nonnegative(),
  /** How long the child took, in real milliseconds: the quiz is about reaction, not lesson time. */
  timeMs: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
});
export type QuizAnswer = z.infer<typeof QuizAnswerSchema>;

export const QuizStateSchema = z.strictObject({
  questionIndex: z.number().int().nonnegative(),
  questionCount: z.number().int().positive(),
  /** Server time when the current question appeared. */
  startedAt: serverTime,
  limitSec: z.number().int().positive(),
  phase: QuizPhaseSchema,
  /** Answers to the current question only; they are cleared when the next one starts. */
  answers: z.record(id, QuizAnswerSchema),
  /** Points for the whole quiz, per participant. */
  scores: z.record(id, z.number().int().nonnegative()),
});
export type QuizState = z.infer<typeof QuizStateSchema>;

/**
 * "Мой экран" and "Экран ученика" (CLAUDE.md §4.4; stage 3, H14; ADR-017). `fullscreen`: the
 * picture covers the whole screen and the classroom computer's input is locked; `window`: a panel,
 * and the child may work alongside. `epoch` tells frames of this broadcast from an earlier one.
 */
export const DemoStateSchema = z.strictObject({
  mode: z.enum(['fullscreen', 'window']),
  source: z.union([z.literal('teacher'), id]),
  epoch: z.number().int().nonnegative(),
});
export type DemoState = z.infer<typeof DemoStateSchema>;

/**
 * Programs a classroom computer may open (H15): only ids travel, a student computer finds the
 * program itself and opens nothing else (apps/desktop-core/AppCatalog.cs).
 */
export const LESSON_APPS = ['paint', 'notepad', 'word', 'excel', 'powerpoint'] as const;
export const LessonAppSchema = z.enum(LESSON_APPS);
export type LessonApp = z.infer<typeof LessonAppSchema>;

/**
 * Which program tiles the children see (CLAUDE.md §4.2; H15). `all: null` — what the lesson's stage
 * gives by itself; the teacher can change it for everybody or for chosen children. A new stage
 * brings back the lesson's own set.
 */
export const AppsStateSchema = z.strictObject({
  all: z.array(LessonAppSchema).nullable(),
  byParticipant: z.record(id, z.array(LessonAppSchema)),
  /**
   * The programs the school allows (stage 5, A3; ADR-021), fixed when the lesson starts; null —
   * every one. Nothing outside it is ever shown, whatever the lesson or the teacher says.
   */
  allowed: z.array(LessonAppSchema).nullable().default(null),
});
export type AppsState = z.infer<typeof AppsStateSchema>;

export const SessionStateSchema = z.strictObject({
  id,
  lessonId: id,
  classId: id,
  status: z.enum(['active', 'ended']),
  mode: SessionModeSchema,
  /** Teacher's current screen (what everyone sees in `presentation` mode). */
  screenIndex,
  stage: StageStateSchema,
  /** 1 = real time; 10 = demo speed, one lesson minute in six seconds. */
  demoSpeed: z.number().int().positive(),
  screenCount: z.number().int().positive(),
  lock: LockStateSchema,
  /** The live quiz, while it is on (S1.12). */
  quiz: QuizStateSchema.nullable().default(null),
  /** A screen broadcast, while it is on (H14). */
  demo: DemoStateSchema.nullable().default(null),
  /** Program tiles set by the teacher (H15); by default the lesson's own. */
  apps: AppsStateSchema.default({ all: null, byParticipant: {}, allowed: null }),
  participants: z.record(id, ParticipantSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// ---------- client → server

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('ping') }),
  z.strictObject({ v, type: z.literal('teacher.screen.set'), index: screenIndex }),
  z.strictObject({ v, type: z.literal('teacher.mode.set'), mode: SessionModeSchema }),
  z.strictObject({
    v,
    type: z.literal('teacher.stage.set'),
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({ v, type: z.literal('teacher.stage.skip') }),
  z.strictObject({ v, type: z.literal('teacher.stage.back') }),
  z.strictObject({ v, type: z.literal('teacher.stage.pause') }),
  z.strictObject({ v, type: z.literal('teacher.stage.resume') }),
  z.strictObject({
    v,
    type: z.literal('teacher.stage.extend'),
    minutes: z.number().int().positive().max(30),
  }),
  z.strictObject({
    v,
    type: z.literal('teacher.demoSpeed.set'),
    speed: z.number().int().positive().max(60),
  }),
  z.strictObject({
    v,
    type: z.literal('teacher.lock'),
    targets: LockTargetsSchema,
    text: LockTextSchema.optional(),
  }),
  z.strictObject({ v, type: z.literal('teacher.unlock'), targets: LockTargetsSchema }),
  /** The teacher answered the child and puts the raised hand down. */
  z.strictObject({ v, type: z.literal('teacher.hand.clear'), participantId: id }),
  /** Stars for the drawing, straight from the child's tile; 0 takes them back (S1.11). */
  z.strictObject({
    v,
    type: z.literal('teacher.stars.set'),
    participantId: id,
    stars: z.number().int().min(0).max(3),
  }),
  /** The live quiz (S1.12): it starts by itself with its stage, and these move it along. */
  z.strictObject({ v, type: z.literal('teacher.quiz.start') }),
  /** Show the right answer now, without waiting for the time to run out. */
  z.strictObject({ v, type: z.literal('teacher.quiz.reveal') }),
  /** One step onwards: question → answer → leaderboard → next question (or the podium). */
  z.strictObject({ v, type: z.literal('teacher.quiz.next') }),
  z.strictObject({ v, type: z.literal('teacher.quiz.finish') }),
  z.strictObject({ v, type: z.literal('teacher.session.end') }),
  /** Show the teacher's screen, or a child's, to the class (H14). */
  z.strictObject({
    v,
    type: z.literal('teacher.demo.start'),
    mode: z.enum(['fullscreen', 'window']),
    source: z.union([z.literal('teacher'), id]),
  }),
  z.strictObject({ v, type: z.literal('teacher.demo.stop') }),
  /** Program tiles for everybody or chosen children; null brings back the lesson's own (H15). */
  z.strictObject({
    v,
    type: z.literal('teacher.apps.set'),
    targets: LockTargetsSchema,
    apps: z.array(LessonAppSchema).max(LESSON_APPS.length).nullable(),
  }),
  z.strictObject({ v, type: z.literal('student.screen.set'), index: screenIndex }),
  z.strictObject({
    v,
    type: z.literal('student.screen.done'),
    index: screenIndex,
    stars: z.number().int().min(0).max(3),
  }),
  /** "Я сделал этот шаг" on a step of the Paint practice, and the same button pressed again (S1.11). */
  z.strictObject({
    v,
    type: z.literal('student.step.done'),
    index: screenIndex,
    done: z.boolean(),
  }),
  z.strictObject({
    v,
    type: z.literal('student.quiz.answer'),
    questionIndex: z.number().int().nonnegative(),
    optionIndex: z.number().int().nonnegative(),
  }),
  z.strictObject({ v, type: z.literal('student.hand'), up: z.boolean() }),
  /** A thumbnail of this classroom computer's screen, only while a teacher watches (H5). */
  z.strictObject({
    v,
    type: z.literal('student.thumb'),
    jpeg: z.string().min(1).max(MAX_THUMB_BASE64),
  }),
  /**
   * A message from the teacher to everybody or chosen children (PLAN.md 4.5; W6), with a link if
   * the teacher gives one. Only web addresses: http and https.
   */
  z.strictObject({
    v,
    type: z.literal('teacher.message'),
    targets: LockTargetsSchema,
    text: z.string().trim().min(1).max(300),
    url: LinkSchema.optional(),
  }),
  /** "Open this screen for everybody" in free mode: each child's lesson jumps there (W6). */
  z.strictObject({ v, type: z.literal('teacher.screen.everyone'), index: screenIndex }),
  /** "Take a screenshot" of chosen children or everybody (H5, CLAUDE.md §4.8). */
  z.strictObject({ v, type: z.literal('teacher.screenshot'), targets: LockTargetsSchema }),
  z.strictObject({
    v,
    type: z.literal('student.visibility'),
    hidden: z.boolean(),
    fullscreen: z.boolean(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ClientMessageOf<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

// ---------- server → client

export const YouSchema = z.strictObject({
  role: RoleSchema,
  participantId: id.nullable(),
  /** Secret that lets the same participant reconnect; students keep it in sessionStorage. */
  participantToken: z.string().nullable(),
});
export type You = z.infer<typeof YouSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('pong'), serverNow: serverTime }),
  z.strictObject({
    v,
    type: z.literal('state.snapshot'),
    state: SessionStateSchema,
    serverNow: serverTime,
    you: YouSchema,
  }),
  z.strictObject({ v, type: z.literal('screen.changed'), index: screenIndex }),
  z.strictObject({ v, type: z.literal('mode.changed'), mode: SessionModeSchema }),
  /** Stage, timer or countdown changed; carries the whole stage state and the server clock. */
  z.strictObject({
    v,
    type: z.literal('stage.changed'),
    stage: StageStateSchema,
    serverNow: serverTime,
  }),
  z.strictObject({ v, type: z.literal('demoSpeed.changed'), speed: z.number().int().positive() }),
  z.strictObject({ v, type: z.literal('lock.changed'), lock: LockStateSchema }),
  /** The whole quiz block at once, the way `stage.changed` carries the whole stage. */
  z.strictObject({
    v,
    type: z.literal('quiz.changed'),
    quiz: QuizStateSchema.nullable(),
    serverNow: serverTime,
  }),
  z.strictObject({ v, type: z.literal('participant.updated'), participant: ParticipantSchema }),
  /** A screen broadcast started, changed or stopped (H14); the frames come as binary messages. */
  z.strictObject({ v, type: z.literal('demo.changed'), demo: DemoStateSchema.nullable() }),
  z.strictObject({ v, type: z.literal('apps.changed'), apps: AppsStateSchema }),
  z.strictObject({ v, type: z.literal('session.ended') }),
  /** To teachers only: the latest thumbnail of one child's screen (H5). */
  z.strictObject({ v, type: z.literal('thumb'), participantId: id, jpeg: z.string().min(1) }),
  /** To students: send thumbnails or stop — only while a teacher's panel is open (CLAUDE.md §3.1). */
  z.strictObject({ v, type: z.literal('thumbs.wanted'), on: z.boolean() }),
  /** A teacher's message (W6); each child shows it if it is for them. */
  z.strictObject({
    v,
    type: z.literal('message'),
    id: z.number().int().nonnegative(),
    targets: LockTargetsSchema,
    text: z.string().min(1).max(300),
    url: LinkSchema.nullable(),
  }),
  /** To students in free mode: go to this screen (W6). */
  z.strictObject({ v, type: z.literal('screen.goto'), index: screenIndex }),
  /** To students: take a screenshot and upload it (H5). */
  z.strictObject({
    v,
    type: z.literal('screenshot.request'),
    targets: LockTargetsSchema,
    reason: ScreenshotReasonSchema,
  }),
  /**
   * To teachers only: a child logged in on another device while still connected on the first one;
   * the first one is closed (CLAUDE.md §4.1 item 7, H8). `from`/`to` are classroom computers, null
   * for a browser.
   */
  z.strictObject({
    v,
    type: z.literal('student.moved'),
    participantId: id,
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  /** The same student logged in from another device; this connection is closed. */
  z.strictObject({ v, type: z.literal('session.kicked') }),
  z.strictObject({ v, type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ServerMessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/** Parses an incoming frame; returns `undefined` for anything that is not a valid message. */
export function parseClientMessage(raw: unknown): ClientMessage | undefined {
  const result = ClientMessageSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

export function parseServerMessage(raw: unknown): ServerMessage | undefined {
  const result = ServerMessageSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
