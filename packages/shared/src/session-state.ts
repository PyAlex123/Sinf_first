import type { Stage } from './lesson.js';
import {
  COUNTDOWN_SEC,
  elapsedMs,
  firstScreenOfStage,
  modeForStage,
  MS_PER_MIN,
  partAt,
  remainingMs,
  stageScreenRange,
  startStage,
} from './stage-timer.js';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type LockTargets,
  type Participant,
  type Role,
  type ServerMessage,
  type SessionState,
} from './protocol.js';

/**
 * Session engine, pure part (ADR-006): `reduce(state, event)` returns the next state, messages to broadcast to the
 * room, replies for the sender and activity records to store. No timers or I/O here; the server runs it, and later
 * the Class Hub will. Stage timing is added in S1.8.
 */

/**
 * What the engine needs to know about the lesson: its stages with timing and the stage of every screen
 * (both come from the import, ADR-005).
 */
export interface LessonPlan {
  stages: readonly Stage[];
  /** `screenStages[i]` is the stage key of screen i. */
  screenStages: readonly string[];
}

export const EMPTY_PLAN: LessonPlan = { stages: [], screenStages: [] };

export type SessionEvent =
  | {
      kind: 'participant.join';
      participantId: string;
      number: number;
      studentId: string | null;
      name: string | null;
      now: number;
    }
  | { kind: 'participant.leave'; participantId: string; now: number }
  | {
      kind: 'command';
      role: Role;
      /** Participant sending the command (students); null for teacher and projector. */
      participantId: string | null;
      message: ClientMessage;
      now: number;
    }
  /** The server timer fired: the engine decides whether to start a countdown or switch the stage. */
  | { kind: 'tick'; now: number };

/** Something worth writing to `activity_events`. */
export interface ActivityRecord {
  type:
    | 'join'
    | 'leave'
    | 'hand_raise'
    | 'tab_hidden'
    | 'fullscreen_exit'
    | 'screen_done'
    | 'lock'
    | 'unlock'
    | 'mode'
    | 'screen'
    | 'stage_change'
    | 'session_end';
  participantId: string | null;
  data?: Record<string, unknown>;
}

export interface ReduceResult {
  state: SessionState;
  broadcast: ServerMessage[];
  reply: ServerMessage[];
  activity: ActivityRecord[];
}

export interface NewSessionInput {
  id: string;
  lessonId: string;
  classId: string;
  screenCount: number;
  /** Server time the lesson starts at. */
  now: number;
  /** 1 = real time, 10 = demo speed (one lesson minute in six seconds). */
  demoSpeed?: number;
  plan?: LessonPlan;
}

export function createSessionState(input: NewSessionInput): SessionState {
  const plan = input.plan ?? EMPTY_PLAN;
  const first = plan.stages[0];
  return {
    id: input.id,
    lessonId: input.lessonId,
    classId: input.classId,
    status: 'active',
    mode: modeForStage(first),
    screenIndex: 0,
    screenCount: input.screenCount,
    stage: startStage(0, input.now, partAt(first, 0)),
    demoSpeed: input.demoSpeed ?? 1,
    lock: { all: null, byParticipant: {} },
    participants: {},
  };
}

const v = PROTOCOL_VERSION;

export function reduce(
  state: SessionState,
  event: SessionEvent,
  plan: LessonPlan = EMPTY_PLAN,
): ReduceResult {
  const result: ReduceResult = { state, broadcast: [], reply: [], activity: [] };
  if (state.status === 'ended') {
    if (event.kind === 'command') {
      result.reply.push({ v, type: 'error', code: 'session_ended', message: 'Session has ended' });
    }
    return result;
  }
  switch (event.kind) {
    case 'participant.join':
      return join(result, event);
    case 'participant.leave':
      return leave(result, event);
    case 'tick':
      return tick(result, event.now, plan);
    case 'command':
      return command(result, event, plan);
  }
}

// ---------- stages and the lesson timer (S1.8)

/** Timer step: start the countdown near the end of a stage, switch when the time is up, follow rest parts. */
function tick(r: ReduceResult, now: number, plan: LessonPlan): ReduceResult {
  if (r.state.stage.pausedAt !== null) return r;
  const left = remainingMs(r.state, plan.stages, now);
  if (left === null) return r;
  if (left <= 0) {
    const next = r.state.stage.index + 1;
    return next < plan.stages.length ? goToStage(r, next, now, plan) : r;
  }
  // Rest inside a split stage (practice 9 + rest 4 + 9).
  const stage = plan.stages[r.state.stage.index];
  const part = partAt(stage, elapsedMs(r.state.stage, r.state.demoSpeed, now));
  if (part !== r.state.stage.part) {
    return setStage(r, { ...r.state.stage, part }, now);
  }
  // Countdown in the last ten lesson seconds.
  const countdownAt = left <= COUNTDOWN_SEC * 1000;
  if (countdownAt && r.state.stage.countdownUntil === null) {
    const until = now + Math.ceil(left / r.state.demoSpeed);
    return setStage(r, { ...r.state.stage, countdownUntil: until }, now);
  }
  return r;
}

/** Switches to a stage: resets its timer, moves everybody to its first screen and picks the mode. */
function goToStage(r: ReduceResult, index: number, now: number, plan: LessonPlan): ReduceResult {
  const stage = plan.stages[index];
  const part = partAt(stage, 0);
  r = setStage(r, startStage(index, now, part), now);
  const screenIndex = firstScreenOfStage(plan.screenStages, stage?.key, r.state.screenIndex);
  if (screenIndex !== r.state.screenIndex) {
    r.state = { ...r.state, screenIndex };
    r.broadcast.push({ v, type: 'screen.changed', index: screenIndex });
  }
  // Nobody stays on a screen of the previous stage (S1.9).
  for (const participant of Object.values(r.state.participants)) {
    if (participant.screenIndex !== screenIndex) {
      r = updateParticipant(r, { ...participant, screenIndex });
    }
  }
  const mode = modeForStage(stage);
  if (mode !== r.state.mode) {
    r.state = { ...r.state, mode };
    r.broadcast.push({ v, type: 'mode.changed', mode });
  }
  r.activity.push({
    type: 'stage_change',
    participantId: null,
    data: { index, key: stage?.key ?? null },
  });
  return r;
}

function setStage(r: ReduceResult, stage: SessionState['stage'], now: number): ReduceResult {
  r.state = { ...r.state, stage };
  r.broadcast.push({ v, type: 'stage.changed', stage, serverNow: now });
  return r;
}

function join(
  r: ReduceResult,
  e: Extract<SessionEvent, { kind: 'participant.join' }>,
): ReduceResult {
  const existing = r.state.participants[e.participantId];
  const participant: Participant = existing
    ? { ...existing, online: true, lastSeenAt: e.now }
    : {
        id: e.participantId,
        number: e.number,
        studentId: e.studentId,
        name: e.name,
        online: true,
        screenIndex: r.state.mode === 'presentation' ? r.state.screenIndex : 0,
        stars: 0,
        doneScreens: [],
        hand: false,
        hidden: false,
        fullscreen: false,
        escapes: 0,
        lastSeenAt: e.now,
      };
  return updateParticipant(r, participant, { type: 'join', participantId: participant.id });
}

function leave(
  r: ReduceResult,
  e: Extract<SessionEvent, { kind: 'participant.leave' }>,
): ReduceResult {
  const existing = r.state.participants[e.participantId];
  if (!existing || !existing.online) {
    return r;
  }
  return updateParticipant(
    r,
    { ...existing, online: false, hand: false, lastSeenAt: e.now },
    { type: 'leave', participantId: existing.id },
  );
}

function command(
  r: ReduceResult,
  e: Extract<SessionEvent, { kind: 'command' }>,
  plan: LessonPlan,
): ReduceResult {
  const m = e.message;
  if (m.type === 'ping') {
    r.reply.push({ v, type: 'pong', serverNow: e.now });
    return r;
  }
  const forTeacher = m.type.startsWith('teacher.');
  if (forTeacher && e.role !== 'teacher') {
    r.reply.push({
      v,
      type: 'error',
      code: 'forbidden',
      message: `${m.type} is a teacher command`,
    });
    return r;
  }
  if (!forTeacher && e.role !== 'student') {
    r.reply.push({
      v,
      type: 'error',
      code: 'forbidden',
      message: `${m.type} is a student command`,
    });
    return r;
  }
  switch (m.type) {
    case 'teacher.screen.set': {
      const index = clampScreen(r.state, m.index);
      if (index === r.state.screenIndex) return r;
      r.state = { ...r.state, screenIndex: index };
      r.broadcast.push({ v, type: 'screen.changed', index });
      r.activity.push({ type: 'screen', participantId: null, data: { index } });
      return r;
    }
    case 'teacher.mode.set': {
      if (m.mode === r.state.mode) return r;
      r.state = { ...r.state, mode: m.mode };
      r.broadcast.push({ v, type: 'mode.changed', mode: m.mode });
      r.activity.push({ type: 'mode', participantId: null, data: { mode: m.mode } });
      return r;
    }
    case 'teacher.lock':
      return setLock(r, m.targets, m.text ?? '');
    case 'teacher.unlock':
      return setLock(r, m.targets, null);
    case 'teacher.hand.clear': {
      const target = r.state.participants[m.participantId];
      if (!target || !target.hand) return r;
      return updateParticipant(
        r,
        { ...target, hand: false },
        {
          type: 'hand_raise',
          participantId: target.id,
          data: { up: false, by: 'teacher' },
        },
      );
    }
    case 'teacher.stage.set':
      return goToStage(r, clampStage(plan, m.index), e.now, plan);
    case 'teacher.stage.skip':
      return r.state.stage.index + 1 < plan.stages.length
        ? goToStage(r, r.state.stage.index + 1, e.now, plan)
        : r;
    case 'teacher.stage.back':
      // Restart the current stage first; a second press goes to the previous one.
      return goToStage(
        r,
        elapsedMs(r.state.stage, r.state.demoSpeed, e.now) > 3000
          ? r.state.stage.index
          : Math.max(0, r.state.stage.index - 1),
        e.now,
        plan,
      );
    case 'teacher.stage.pause':
      if (r.state.stage.pausedAt !== null) return r;
      return setStage(r, { ...r.state.stage, pausedAt: e.now, countdownUntil: null }, e.now);
    case 'teacher.stage.resume': {
      const pausedAt = r.state.stage.pausedAt;
      if (pausedAt === null) return r;
      // Shift the start by the pause, so the elapsed lesson time stays the same.
      return setStage(
        r,
        {
          ...r.state.stage,
          startedAt: r.state.stage.startedAt + (e.now - pausedAt),
          pausedAt: null,
        },
        e.now,
      );
    }
    case 'teacher.stage.extend':
      return setStage(
        r,
        {
          ...r.state.stage,
          extraMs: r.state.stage.extraMs + m.minutes * MS_PER_MIN,
          countdownUntil: null,
        },
        e.now,
      );
    case 'teacher.demoSpeed.set': {
      if (m.speed === r.state.demoSpeed) return r;
      // Keep the elapsed lesson time across the speed change.
      const elapsed = elapsedMs(r.state.stage, r.state.demoSpeed, e.now);
      const base = r.state.stage.pausedAt ?? e.now;
      r.state = { ...r.state, demoSpeed: m.speed };
      r.broadcast.push({ v, type: 'demoSpeed.changed', speed: m.speed });
      return setStage(
        r,
        { ...r.state.stage, startedAt: base - Math.round(elapsed / m.speed), countdownUntil: null },
        e.now,
      );
    }
    case 'teacher.session.end':
      r.state = { ...r.state, status: 'ended' };
      r.broadcast.push({ v, type: 'session.ended' });
      r.activity.push({ type: 'session_end', participantId: null });
      return r;
    case 'student.screen.set':
    case 'student.screen.done':
    case 'student.hand':
    case 'student.visibility':
      return studentCommand(r, e, m, plan);
  }
}

function studentCommand(
  r: ReduceResult,
  e: Extract<SessionEvent, { kind: 'command' }>,
  m: Exclude<ClientMessage, { type: `teacher.${string}` | 'ping' }>,
  plan: LessonPlan,
): ReduceResult {
  const p = e.participantId ? r.state.participants[e.participantId] : undefined;
  if (!p) {
    r.reply.push({
      v,
      type: 'error',
      code: 'unknown_participant',
      message: 'Join the session first',
    });
    return r;
  }
  switch (m.type) {
    case 'student.screen.set': {
      // In presentation mode the teacher drives every screen; in free mode a student walks
      // through the screens of the current stage only (STAGE1 S1.9).
      if (r.state.mode === 'presentation') return r;
      const index = clampToStage(r.state, plan, m.index);
      if (index === p.screenIndex) return r;
      return updateParticipant(r, { ...p, screenIndex: index, lastSeenAt: e.now });
    }
    case 'student.screen.done': {
      const index = clampScreen(r.state, m.index);
      if (p.doneScreens.includes(index)) return r;
      return updateParticipant(
        r,
        {
          ...p,
          stars: p.stars + m.stars,
          doneScreens: [...p.doneScreens, index],
          lastSeenAt: e.now,
        },
        { type: 'screen_done', participantId: p.id, data: { index, stars: m.stars } },
      );
    }
    case 'student.hand': {
      if (m.up === p.hand) return r;
      return updateParticipant(
        r,
        { ...p, hand: m.up, lastSeenAt: e.now },
        m.up ? { type: 'hand_raise', participantId: p.id } : undefined,
      );
    }
    case 'student.visibility': {
      if (m.hidden === p.hidden && m.fullscreen === p.fullscreen) return r;
      const activity: ActivityRecord | undefined =
        m.hidden && !p.hidden
          ? { type: 'tab_hidden', participantId: p.id }
          : !m.fullscreen && p.fullscreen
            ? { type: 'fullscreen_exit', participantId: p.id }
            : undefined;
      // Leaving counts; coming back does not, so the teacher sees how often the child slipped away.
      const escapes = activity ? p.escapes + 1 : p.escapes;
      return updateParticipant(
        r,
        { ...p, hidden: m.hidden, fullscreen: m.fullscreen, escapes, lastSeenAt: e.now },
        activity,
      );
    }
  }
}

function setLock(r: ReduceResult, targets: LockTargets, text: string | null): ReduceResult {
  const lock = { all: r.state.lock.all, byParticipant: { ...r.state.lock.byParticipant } };
  if (targets === 'all') {
    lock.all = text === null ? null : { text };
    if (text === null) lock.byParticipant = {};
  } else {
    for (const participantId of targets) {
      if (text === null) delete lock.byParticipant[participantId];
      else lock.byParticipant[participantId] = { text };
    }
  }
  r.state = { ...r.state, lock };
  r.broadcast.push({ v, type: 'lock.changed', lock });
  r.activity.push({
    type: text === null ? 'unlock' : 'lock',
    participantId: null,
    data: { targets, ...(text === null ? {} : { text }) },
  });
  return r;
}

function updateParticipant(
  r: ReduceResult,
  participant: Participant,
  activity?: ActivityRecord,
): ReduceResult {
  r.state = {
    ...r.state,
    participants: { ...r.state.participants, [participant.id]: participant },
  };
  r.broadcast.push({ v, type: 'participant.updated', participant });
  if (activity) r.activity.push(activity);
  return r;
}

/** Keeps a screen index inside the current stage, or inside the lesson when the stage has no screens. */
function clampToStage(state: SessionState, plan: LessonPlan, index: number): number {
  const range = stageScreenRange(plan.screenStages, plan.stages[state.stage.index]?.key);
  if (!range) return clampScreen(state, index);
  return Math.max(range.from, Math.min(range.to, index));
}

function clampStage(plan: LessonPlan, index: number): number {
  return Math.max(0, Math.min(Math.max(0, plan.stages.length - 1), index));
}

function clampScreen(state: SessionState, index: number): number {
  return Math.max(0, Math.min(state.screenCount - 1, index));
}

/** Is this participant's screen locked, and with what text? */
export function lockFor(state: SessionState, participantId: string): { text: string } | null {
  return state.lock.byParticipant[participantId] ?? state.lock.all;
}

/** Next free participant number ("Student N"). */
export function nextParticipantNumber(state: SessionState): number {
  return Object.values(state.participants).reduce((max, p) => Math.max(max, p.number), 0) + 1;
}
