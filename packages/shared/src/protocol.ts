import { z } from 'zod';

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
  hand: z.boolean(),
  /** Tab hidden or another window focused (`visibilitychange`). */
  hidden: z.boolean(),
  fullscreen: z.boolean(),
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
});
export type StageState = z.infer<typeof StageStateSchema>;

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
  z.strictObject({ v, type: z.literal('teacher.session.end') }),
  z.strictObject({ v, type: z.literal('student.screen.set'), index: screenIndex }),
  z.strictObject({
    v,
    type: z.literal('student.screen.done'),
    index: screenIndex,
    stars: z.number().int().min(0).max(3),
  }),
  z.strictObject({ v, type: z.literal('student.hand'), up: z.boolean() }),
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
  z.strictObject({ v, type: z.literal('participant.updated'), participant: ParticipantSchema }),
  z.strictObject({ v, type: z.literal('session.ended') }),
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
