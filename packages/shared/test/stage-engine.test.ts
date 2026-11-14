import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_SEC,
  createSessionState,
  elapsedMs,
  modeForStage,
  MS_PER_MIN,
  partAt,
  realMsUntilPartChange,
  realMsUntilStageEnd,
  reduce,
  remainingMs,
  stageScreenRange,
  type ClientMessage,
  type LessonPlan,
  type SessionState,
  type Stage,
} from '../src/index.js';

/** Stages of lesson 10 as the import produces them (ADR-005). */
const STAGES: Stage[] = [
  { key: 'greeting', title: 'приветствие', startMin: 0, endMin: 2, place: null },
  { key: 'goal', title: 'цель', startMin: 2, endMin: 5, place: null },
  { key: 'theory', title: 'теория', startMin: 5, endMin: 15, place: 'projector' },
  {
    key: 'practice',
    title: 'практика',
    startMin: 15,
    endMin: 37,
    place: 'computer',
    parts: [
      { kind: 'work', minutes: 9 },
      { kind: 'rest', minutes: 4 },
      { kind: 'work', minutes: 9 },
    ],
  },
  { key: 'reflection', title: 'рефлексия', startMin: 37, endMin: 42, place: null },
  { key: 'summary', title: 'итог', startMin: 42, endMin: 45, place: null },
];

/** Screen → stage, like the screens of g10: two greeting, two goal, six theory, … */
const SCREEN_STAGES = [
  'greeting',
  'greeting',
  'goal',
  'goal',
  'theory',
  'theory',
  'practice',
  'practice',
  'reflection',
  'summary',
];

const PLAN: LessonPlan = { stages: STAGES, screenStages: SCREEN_STAGES };
const T0 = 1_000_000;

function start(demoSpeed = 1): SessionState {
  return createSessionState({
    id: 's1',
    lessonId: 'g10',
    classId: 'class-1a',
    screenCount: SCREEN_STAGES.length,
    now: T0,
    demoSpeed,
    plan: PLAN,
  });
}

const teacher = (state: SessionState, message: ClientMessage, now: number) =>
  reduce(state, { kind: 'command', role: 'teacher', participantId: null, message, now }, PLAN);

const tick = (state: SessionState, now: number) => reduce(state, { kind: 'tick', now }, PLAN);

const student = (state: SessionState, message: ClientMessage, now = T0) =>
  reduce(state, { kind: 'command', role: 'student', participantId: 'p1', message, now }, PLAN);

const withStudent = (state: SessionState) =>
  reduce(
    state,
    {
      kind: 'participant.join',
      participantId: 'p1',
      number: 1,
      studentId: 's1',
      name: 'Ученик',
      now: T0,
    },
    PLAN,
  ).state;

/** Runs the timer forward in small steps, as the server does, and returns the stages it passed. */
function runLesson(state: SessionState, stepMs: number, untilMs: number): string[] {
  const seen: string[] = [STAGES[state.stage.index]?.key ?? ''];
  for (let now = T0; now <= T0 + untilMs; now += stepMs) {
    const next = tick(state, now);
    state = next.state;
    const key = STAGES[state.stage.index]?.key ?? '';
    if (seen.at(-1) !== key) seen.push(key);
  }
  return seen;
}

describe('lesson start', () => {
  it('begins on the first stage, its first screen and the matching mode', () => {
    const state = start();
    expect(state.stage).toMatchObject({ index: 0, startedAt: T0, pausedAt: null, extraMs: 0 });
    expect(state.screenIndex).toBe(0);
    expect(state.mode).toBe('presentation');
    expect(state.demoSpeed).toBe(1);
    expect(remainingMs(state, STAGES, T0)).toBe(2 * MS_PER_MIN);
  });
});

describe('automatic stage switching', () => {
  it('shows a countdown in the last ten seconds and then switches', () => {
    let state = start();
    const almost = T0 + 2 * MS_PER_MIN - (COUNTDOWN_SEC - 1) * 1000;
    const counting = tick(state, almost);
    state = counting.state;
    expect(state.stage.countdownUntil).toBe(T0 + 2 * MS_PER_MIN);
    expect(counting.broadcast.some((m) => m.type === 'stage.changed')).toBe(true);
    expect(state.stage.index).toBe(0);

    const switched = tick(state, T0 + 2 * MS_PER_MIN);
    expect(switched.state.stage.index).toBe(1);
    expect(switched.state.stage.countdownUntil).toBeNull();
    expect(switched.state.screenIndex).toBe(2); // first screen of "goal"
    expect(switched.activity).toEqual([
      { type: 'stage_change', participantId: null, data: { index: 1, key: 'goal' } },
    ]);
  });

  it('switches the mode: theory is presented, practice is free work', () => {
    let state = start();
    state = teacher(state, { v: 1, type: 'teacher.stage.set', index: 2 }, T0).state;
    expect(state.mode).toBe('presentation');
    const practice = teacher(state, { v: 1, type: 'teacher.stage.set', index: 3 }, T0);
    expect(practice.state.mode).toBe('free');
    expect(practice.broadcast.some((m) => m.type === 'mode.changed')).toBe(true);
    expect(modeForStage(STAGES[3])).toBe('free');
  });

  it('runs the whole lesson without a single press at demo speed', () => {
    const state = start(10);
    // 45 lesson minutes at speed 10 = 270 real seconds; step every real second.
    const seen = runLesson(state, 1000, 280_000);
    expect(seen).toEqual(['greeting', 'goal', 'theory', 'practice', 'reflection', 'summary']);
  });

  it('stops on the last stage instead of running past the end', () => {
    let state = start(10);
    state = teacher(state, { v: 1, type: 'teacher.stage.set', index: 5 }, T0).state;
    const after = tick(state, T0 + 60_000);
    expect(after.state.stage.index).toBe(5);
    expect(after.state.status).toBe('active');
  });
});

describe('rest inside practice', () => {
  it('marks work → rest → work as the practice stage runs', () => {
    let state = start();
    state = teacher(state, { v: 1, type: 'teacher.stage.set', index: 3 }, T0).state;
    expect(state.stage.part).toBe('work');
    expect(realMsUntilPartChange(state, STAGES, T0)).toBe(9 * MS_PER_MIN);

    const rest = tick(state, T0 + 9 * MS_PER_MIN);
    expect(rest.state.stage.part).toBe('rest');
    expect(rest.broadcast.some((m) => m.type === 'stage.changed')).toBe(true);

    const back = tick(rest.state, T0 + 13 * MS_PER_MIN);
    expect(back.state.stage.part).toBe('work');
    expect(partAt(STAGES[3], 22 * MS_PER_MIN)).toBe('work');
    expect(partAt(STAGES[0], 0)).toBeNull();
  });
});

describe('teacher controls', () => {
  it('pause freezes the timer and resume keeps the elapsed time', () => {
    let state = start();
    const paused = teacher(state, { v: 1, type: 'teacher.stage.pause' }, T0 + 30_000);
    state = paused.state;
    expect(state.stage.pausedAt).toBe(T0 + 30_000);
    expect(elapsedMs(state.stage, 1, T0 + 90_000)).toBe(30_000); // clock stands still
    expect(realMsUntilStageEnd(state, STAGES, T0 + 90_000)).toBeNull();
    expect(tick(state, T0 + 10 * MS_PER_MIN).state.stage.index).toBe(0); // no switch while paused

    const resumed = teacher(state, { v: 1, type: 'teacher.stage.resume' }, T0 + 90_000);
    expect(elapsedMs(resumed.state.stage, 1, T0 + 90_000)).toBe(30_000);
    expect(remainingMs(resumed.state, STAGES, T0 + 90_000)).toBe(90_000);
  });

  it('"+5 min" adds lesson time and clears a running countdown', () => {
    let state = start();
    state = tick(state, T0 + 2 * MS_PER_MIN - 5000).state;
    expect(state.stage.countdownUntil).not.toBeNull();
    const extended = teacher(
      state,
      { v: 1, type: 'teacher.stage.extend', minutes: 5 },
      T0 + 115_000,
    );
    expect(extended.state.stage.extraMs).toBe(5 * MS_PER_MIN);
    expect(extended.state.stage.countdownUntil).toBeNull();
    expect(remainingMs(extended.state, STAGES, T0 + 115_000)).toBe(5 * MS_PER_MIN + 5000);
  });

  it('skip goes forward, back restarts the stage and then steps back', () => {
    let state = start();
    state = teacher(state, { v: 1, type: 'teacher.stage.skip' }, T0).state;
    expect(state.stage.index).toBe(1);
    // long into the stage: "back" restarts it
    const restart = teacher(state, { v: 1, type: 'teacher.stage.back' }, T0 + 60_000);
    expect(restart.state.stage.index).toBe(1);
    expect(restart.state.stage.startedAt).toBe(T0 + 60_000);
    // right after a switch: "back" goes to the previous stage
    const previous = teacher(restart.state, { v: 1, type: 'teacher.stage.back' }, T0 + 61_000);
    expect(previous.state.stage.index).toBe(0);
    expect(previous.state.screenIndex).toBe(0);
  });

  it('changing the demo speed keeps the elapsed lesson time', () => {
    let state = start(1);
    state = tick(state, T0 + 30_000).state;
    const fast = teacher(state, { v: 1, type: 'teacher.demoSpeed.set', speed: 10 }, T0 + 30_000);
    expect(fast.state.demoSpeed).toBe(10);
    expect(elapsedMs(fast.state.stage, 10, T0 + 30_000)).toBe(30_000);
    expect(fast.broadcast.some((m) => m.type === 'demoSpeed.changed')).toBe(true);
  });

  it('refuses stage commands from students', () => {
    const state = start();
    const result = reduce(
      state,
      {
        kind: 'command',
        role: 'student',
        participantId: 'p1',
        message: { v: 1, type: 'teacher.stage.skip' },
        now: T0,
      },
      PLAN,
    );
    expect(result.reply[0]).toMatchObject({ code: 'forbidden' });
    expect(result.state.stage.index).toBe(0);
  });
});

describe('free mode stays inside the stage (S1.9)', () => {
  it('knows the screen range of every stage', () => {
    expect(stageScreenRange(SCREEN_STAGES, 'greeting')).toEqual({ from: 0, to: 1 });
    expect(stageScreenRange(SCREEN_STAGES, 'theory')).toEqual({ from: 4, to: 5 });
    expect(stageScreenRange(SCREEN_STAGES, 'summary')).toEqual({ from: 9, to: 9 });
    expect(stageScreenRange(SCREEN_STAGES, 'quiz')).toBeNull();
  });

  it('clamps a student to the screens of the current stage', () => {
    let state = withStudent(start());
    // practice: screens 6..7, free mode
    state = teacher(state, { v: 1, type: 'teacher.stage.set', index: 3 }, T0).state;
    expect(state.mode).toBe('free');
    expect(state.participants['p1']?.screenIndex).toBe(6);

    const forward = student(state, { v: 1, type: 'student.screen.set', index: 7 });
    expect(forward.state.participants['p1']?.screenIndex).toBe(7);
    // beyond the stage: stays on the last screen of the stage
    const tooFar = student(forward.state, { v: 1, type: 'student.screen.set', index: 9 });
    expect(tooFar.state.participants['p1']?.screenIndex).toBe(7);
    // before the stage: stays on the first one
    const tooEarly = student(forward.state, { v: 1, type: 'student.screen.set', index: 0 });
    expect(tooEarly.state.participants['p1']?.screenIndex).toBe(6);
  });

  it('ignores a student moving the screen while the teacher presents', () => {
    let state = withStudent(start());
    state = teacher(state, { v: 1, type: 'teacher.stage.set', index: 2 }, T0).state; // theory → presentation
    expect(state.mode).toBe('presentation');
    const result = student(state, { v: 1, type: 'student.screen.set', index: 5 });
    expect(result.state.participants['p1']?.screenIndex).toBe(4);
    expect(result.broadcast).toEqual([]);
  });

  it('moves everybody to the first screen of the new stage', () => {
    let state = withStudent(start());
    state = teacher(state, { v: 1, type: 'teacher.stage.set', index: 3 }, T0).state;
    state = student(state, { v: 1, type: 'student.screen.set', index: 7 }).state;
    expect(state.participants['p1']?.screenIndex).toBe(7);

    const next = teacher(state, { v: 1, type: 'teacher.stage.skip' }, T0 + 1000);
    expect(next.state.stage.index).toBe(4);
    expect(next.state.screenIndex).toBe(8);
    expect(next.state.participants['p1']?.screenIndex).toBe(8);
    expect(next.broadcast.some((m) => m.type === 'participant.updated')).toBe(true);
  });
});
