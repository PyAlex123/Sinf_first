import type { Stage } from './lesson.js';
import { scoreAnswer, type Quiz } from './quiz.js';
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
  type QuizState,
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
  /** Indexes of the step-by-step practice screens, in lesson order (S1.11). */
  stepScreens: readonly number[];
  /** The live quiz of this lesson, if it has one (S1.12). It runs in the reflection stage. */
  quiz: Quiz | null;
}

export const EMPTY_PLAN: LessonPlan = {
  stages: [],
  screenStages: [],
  stepScreens: [],
  quiz: null,
};

/** The stage the quiz takes over: its time is the reflection's (docs/stage1-architecture.md §7). */
export const QUIZ_STAGE_KEY = 'reflection';

/** The practice stage: its screenshots are taken by themselves (stage 3, H5; CLAUDE.md §4.8). */
export const PRACTICE_STAGE_KEY = 'practice';
/** How long before the practice ends the screenshots are taken, in lesson time (CLAUDE.md §4.8). */
export const SCREENSHOT_BEFORE_END_MS = 5 * 60_000;

export type SessionEvent =
  | {
      kind: 'participant.join';
      participantId: string;
      number: number;
      studentId: string | null;
      name: string | null;
      /** A demo student played by the server (S1.15). */
      virtual?: boolean;
      /** The classroom computer, when the child logged in from the classroom app (stage 3). */
      pc?: string | null;
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
    | 'step_done'
    | 'practice_stars'
    | 'quiz_answer'
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
    quiz: null,
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
  // The quiz keeps real time: twenty seconds are twenty seconds, whatever the lesson speed.
  const quiz = r.state.quiz;
  if (quiz && quiz.phase === 'question' && now - quiz.startedAt >= quiz.limitSec * 1000) {
    r = setQuiz(r, { ...quiz, phase: 'reveal' }, now);
  }
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
  // Five lesson minutes before the practice ends: everybody's work is photographed (H5).
  if (
    stage?.key === PRACTICE_STAGE_KEY &&
    !r.state.stage.shotRequested &&
    left <= SCREENSHOT_BEFORE_END_MS
  ) {
    r = setStage(r, { ...r.state.stage, shotRequested: true }, now);
    r.broadcast.push({ v, type: 'screenshot.request', targets: 'all', reason: 'before_end' });
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
  // Leaving the practice: the work as it stands is photographed (H5, CLAUDE.md §4.8).
  const leaving = plan.stages[r.state.stage.index];
  if (leaving?.key === PRACTICE_STAGE_KEY && index !== r.state.stage.index) {
    r.broadcast.push({ v, type: 'screenshot.request', targets: 'all', reason: 'stage_end' });
  }
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
  // The quiz belongs to one stage: it starts with it and does not outlive it.
  if (stage?.key === QUIZ_STAGE_KEY && plan.quiz) return startQuiz(r, now, plan);
  if (r.state.quiz) return setQuiz(r, null, now);
  return r;
}

// ---------- the live quiz (S1.12)

/**
 * The quiz runs in its own stage and starts by itself when that stage begins (CLAUDE.md §4.3): a
 * teacher who has just finished the practice should not have to remember a button. The buttons are
 * there anyway, because a real lesson never goes exactly to plan.
 */
function startQuiz(r: ReduceResult, now: number, plan: LessonPlan): ReduceResult {
  const quiz = plan.quiz;
  if (!quiz || r.state.quiz) return r;
  const first = quiz.questions[0];
  if (!first) return r;
  return setQuiz(
    r,
    {
      questionIndex: 0,
      questionCount: quiz.questions.length,
      startedAt: now,
      limitSec: first.limitSec,
      phase: 'question',
      answers: {},
      // Scores survive the whole quiz; answers are only ever about the question on screen.
      scores: {},
    },
    now,
  );
}

function setQuiz(r: ReduceResult, quiz: QuizState | null, now: number): ReduceResult {
  r.state = { ...r.state, quiz };
  r.broadcast.push({ v, type: 'quiz.changed', quiz, serverNow: now });
  return r;
}

/** One step onwards: question → right answer → leaderboard → next question, and finally the podium. */
function advanceQuiz(r: ReduceResult, now: number, plan: LessonPlan): ReduceResult {
  const quiz = r.state.quiz;
  if (!quiz || !plan.quiz) return r;
  if (quiz.phase === 'question') return setQuiz(r, { ...quiz, phase: 'reveal' }, now);
  if (quiz.phase === 'reveal') return setQuiz(r, { ...quiz, phase: 'leaderboard' }, now);
  if (quiz.phase === 'podium') return r;
  const next = quiz.questionIndex + 1;
  const question = plan.quiz.questions[next];
  if (!question) return setQuiz(r, { ...quiz, phase: 'podium' }, now);
  return setQuiz(
    r,
    {
      ...quiz,
      questionIndex: next,
      startedAt: now,
      limitSec: question.limitSec,
      phase: 'question',
      answers: {},
    },
    now,
  );
}

function answerQuiz(
  r: ReduceResult,
  participantId: string,
  questionIndex: number,
  optionIndex: number,
  now: number,
  plan: LessonPlan,
): ReduceResult {
  const quiz = r.state.quiz;
  const question = plan.quiz?.questions[quiz?.questionIndex ?? -1];
  if (!quiz || !question || quiz.phase !== 'question') return r;
  // A late message about the previous question, or a second press: neither counts.
  if (questionIndex !== quiz.questionIndex || quiz.answers[participantId]) return r;
  if (optionIndex >= question.options.length) return r;
  const limitMs = quiz.limitSec * 1000;
  const timeMs = Math.max(0, now - quiz.startedAt);
  if (timeMs > limitMs) return r;
  const correct = optionIndex === question.correct;
  const points = scoreAnswer(correct, timeMs, limitMs);
  const answers = { ...quiz.answers, [participantId]: { optionIndex, timeMs, points } };
  const scores = { ...quiz.scores, [participantId]: (quiz.scores[participantId] ?? 0) + points };
  r.activity.push({
    type: 'quiz_answer',
    participantId,
    data: { questionIndex, optionIndex, correct, timeMs, points },
  });
  // When the last of the class has pressed, nobody should sit watching a timer run down.
  const everyone = Object.values(r.state.participants).filter((p) => p.online);
  const answered = everyone.every((p) => answers[p.id]);
  return setQuiz(
    r,
    { ...quiz, answers, scores, phase: answered && everyone.length > 0 ? 'reveal' : quiz.phase },
    now,
  );
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
    ? {
        ...existing,
        online: true,
        lastSeenAt: e.now,
        // A child who logs in again from another computer is now at that one.
        ...(e.pc !== undefined ? { pc: e.pc } : {}),
      }
    : {
        id: e.participantId,
        number: e.number,
        studentId: e.studentId,
        name: e.name,
        online: true,
        screenIndex: r.state.mode === 'presentation' ? r.state.screenIndex : 0,
        stars: 0,
        doneScreens: [],
        steps: [],
        practiceStars: null,
        hand: false,
        hidden: false,
        fullscreen: false,
        escapes: 0,
        virtual: e.virtual ?? false,
        pc: e.pc ?? null,
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
    case 'teacher.screenshot':
      // Classroom computers answer by uploading; a browser cannot photograph its screen (H5).
      r.broadcast.push({ v, type: 'screenshot.request', targets: m.targets, reason: 'manual' });
      return r;
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
    case 'teacher.stars.set': {
      const target = r.state.participants[m.participantId];
      if (!target) return r;
      // Zero takes the stars back; the tile then looks as it did before they were given.
      const stars = m.stars === 0 ? null : m.stars;
      if (target.practiceStars === stars) return r;
      return updateParticipant(
        r,
        { ...target, practiceStars: stars },
        { type: 'practice_stars', participantId: target.id, data: { stars: m.stars } },
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
    case 'teacher.quiz.start':
      return startQuiz(r, e.now, plan);
    case 'teacher.quiz.reveal': {
      const quiz = r.state.quiz;
      return quiz && quiz.phase === 'question'
        ? setQuiz(r, { ...quiz, phase: 'reveal' }, e.now)
        : r;
    }
    case 'teacher.quiz.next':
      return advanceQuiz(r, e.now, plan);
    case 'teacher.quiz.finish':
      return r.state.quiz ? setQuiz(r, null, e.now) : r;
    case 'teacher.session.end':
      r.state = { ...r.state, status: 'ended' };
      r.broadcast.push({ v, type: 'session.ended' });
      r.activity.push({ type: 'session_end', participantId: null });
      return r;
    case 'student.screen.set':
    case 'student.screen.done':
    case 'student.step.done':
    case 'student.quiz.answer':
    case 'student.hand':
    case 'student.visibility':
    case 'student.thumb':
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
    case 'student.step.done': {
      // Only a real step of this lesson, so a stray message cannot invent progress.
      if (!plan.stepScreens.includes(m.index)) return r;
      const has = p.steps.includes(m.index);
      if (has === m.done) return r;
      const steps = m.done ? [...p.steps, m.index] : p.steps.filter((i) => i !== m.index);
      return updateParticipant(
        r,
        { ...p, steps, lastSeenAt: e.now },
        { type: 'step_done', participantId: p.id, data: { index: m.index, done: m.done } },
      );
    }
    case 'student.quiz.answer':
      return answerQuiz(r, p.id, m.questionIndex, m.optionIndex, e.now, plan);
    case 'student.thumb':
      // Thumbnails are relayed by the room to the teacher's screens; they are not lesson state (H5).
      return r;
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
