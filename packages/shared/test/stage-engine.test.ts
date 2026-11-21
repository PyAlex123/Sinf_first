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
  type Quiz,
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

// Screens 4 and 5 are the practice; in a club lesson those are the Paint steps (S1.11).
const PLAN: LessonPlan = {
  stages: STAGES,
  screenStages: SCREEN_STAGES,
  stepScreens: [4, 5],
  quiz: null,
};
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

describe('the Paint practice (S1.11)', () => {
  it('marks a step as done and takes it back', () => {
    let state = withStudent(start());
    state = teacher(state, { v: 1, type: 'teacher.stage.set', index: 3 }, T0).state;

    const done = student(state, { v: 1, type: 'student.step.done', index: 4, done: true });
    expect(done.state.participants['p1']?.steps).toEqual([4]);
    expect(done.activity.map((a) => a.type)).toContain('step_done');
    expect(done.broadcast.some((m) => m.type === 'participant.updated')).toBe(true);

    // The same press again says nothing new.
    const again = student(done.state, { v: 1, type: 'student.step.done', index: 4, done: true });
    expect(again.broadcast).toEqual([]);

    const undone = student(done.state, { v: 1, type: 'student.step.done', index: 4, done: false });
    expect(undone.state.participants['p1']?.steps).toEqual([]);
  });

  it('counts only the real steps of this lesson', () => {
    const state = withStudent(start());
    // Screen 9 is the summary slide, not a step: nothing to mark there.
    const result = student(state, { v: 1, type: 'student.step.done', index: 9, done: true });
    expect(result.state.participants['p1']?.steps).toEqual([]);
    expect(result.broadcast).toEqual([]);
  });

  it('lets the teacher give stars for the drawing and take them back', () => {
    const state = withStudent(start());
    const given = teacher(
      state,
      { v: 1, type: 'teacher.stars.set', participantId: 'p1', stars: 3 },
      T0,
    );
    expect(given.state.participants['p1']?.practiceStars).toBe(3);
    expect(given.activity.map((a) => a.type)).toContain('practice_stars');

    const changed = teacher(
      given.state,
      { v: 1, type: 'teacher.stars.set', participantId: 'p1', stars: 2 },
      T0,
    );
    expect(changed.state.participants['p1']?.practiceStars).toBe(2);

    const taken = teacher(
      changed.state,
      { v: 1, type: 'teacher.stars.set', participantId: 'p1', stars: 0 },
      T0,
    );
    expect(taken.state.participants['p1']?.practiceStars).toBeNull();

    // Stars for the drawing are the teacher's; the trainer stars are not touched.
    expect(taken.state.participants['p1']?.stars).toBe(0);
  });

  it('does not let a student give themselves stars for the drawing', () => {
    const state = withStudent(start());
    const result = student(state, {
      v: 1,
      type: 'teacher.stars.set',
      participantId: 'p1',
      stars: 3,
    });
    expect(result.state.participants['p1']?.practiceStars).toBeNull();
    expect(result.reply.some((m) => m.type === 'error')).toBe(true);
  });
});

describe('the live quiz (S1.12)', () => {
  const QUIZ: Quiz = {
    lessonId: 'g10',
    questions: [
      {
        text: 'Что после дождя?',
        say: 'Что после дождя?',
        options: [{ pic: 'rain' }, { pic: 'rainbow' }],
        correct: 1,
        limitSec: 20,
      },
      {
        text: 'Что сначала?',
        say: 'Что сначала?',
        options: [{ pic: 'seed' }, { pic: 'tree' }],
        correct: 0,
        limitSec: 20,
      },
    ],
  };
  const QPLAN: LessonPlan = { ...PLAN, quiz: QUIZ };

  const start = (): SessionState =>
    createSessionState({
      id: 's1',
      lessonId: 'g10',
      classId: 'class-1a',
      screenCount: SCREEN_STAGES.length,
      now: T0,
      plan: QPLAN,
    });

  const withTwo = (state: SessionState): SessionState => {
    for (const [id, number] of [
      ['p1', 1],
      ['p2', 2],
    ] as const) {
      state = reduce(
        state,
        {
          kind: 'participant.join',
          participantId: id,
          number,
          studentId: id,
          name: id,
          now: T0,
        },
        QPLAN,
      ).state;
    }
    return state;
  };

  const run = (state: SessionState, message: ClientMessage, now: number, who?: string) =>
    reduce(
      state,
      {
        kind: 'command',
        role: who ? 'student' : 'teacher',
        participantId: who ?? null,
        message,
        now,
      },
      QPLAN,
    );

  /** Reflection is stage 4 in this plan; that is where the quiz lives. */
  const toQuizStage = (state: SessionState) =>
    run(state, { v: 1, type: 'teacher.stage.set', index: 4 }, T0);

  it('starts by itself when its stage begins', () => {
    const result = toQuizStage(withTwo(start()));
    expect(result.state.quiz).toMatchObject({
      questionIndex: 0,
      questionCount: 2,
      phase: 'question',
      limitSec: 20,
    });
    expect(result.broadcast.some((m) => m.type === 'quiz.changed')).toBe(true);
  });

  it('counts an answer once, scores speed and ignores a late one', () => {
    let state = toQuizStage(withTwo(start())).state;
    const quick = run(
      state,
      { v: 1, type: 'student.quiz.answer', questionIndex: 0, optionIndex: 1 },
      T0 + 2000,
      'p1',
    );
    expect(quick.state.quiz?.scores['p1']).toBe(950);
    expect(quick.activity.map((a) => a.type)).toContain('quiz_answer');
    state = quick.state;

    // The same child pressing again changes nothing.
    const again = run(
      state,
      { v: 1, type: 'student.quiz.answer', questionIndex: 0, optionIndex: 0 },
      T0 + 3000,
      'p1',
    );
    expect(again.state.quiz?.scores['p1']).toBe(950);
    expect(again.broadcast).toEqual([]);

    // A wrong answer is worth nothing, but it is still an answer.
    const wrong = run(
      state,
      { v: 1, type: 'student.quiz.answer', questionIndex: 0, optionIndex: 0 },
      T0 + 4000,
      'p2',
    );
    expect(wrong.state.quiz?.scores['p2']).toBe(0);
    expect(wrong.state.quiz?.answers['p2']).toMatchObject({ optionIndex: 0, points: 0 });
  });

  it('shows the answer as soon as the whole class has pressed', () => {
    let state = toQuizStage(withTwo(start())).state;
    state = run(
      state,
      { v: 1, type: 'student.quiz.answer', questionIndex: 0, optionIndex: 1 },
      T0 + 1000,
      'p1',
    ).state;
    expect(state.quiz?.phase).toBe('question');
    state = run(
      state,
      { v: 1, type: 'student.quiz.answer', questionIndex: 0, optionIndex: 0 },
      T0 + 1500,
      'p2',
    ).state;
    expect(state.quiz?.phase).toBe('reveal');
  });

  it('shows the answer when the time runs out, whatever the lesson speed', () => {
    const state = toQuizStage(withTwo(start())).state;
    expect(tick(state, T0 + 19_000).state.quiz?.phase).toBe('question');
    expect(tick(state, T0 + 20_001).state.quiz?.phase).toBe('reveal');
  });

  it('walks question → answer → leaderboard → next question → podium', () => {
    let state = toQuizStage(withTwo(start())).state;
    const next = (now: number) => {
      state = run(state, { v: 1, type: 'teacher.quiz.next' }, now).state;
      return state.quiz;
    };
    expect(next(T0 + 1000)?.phase).toBe('reveal');
    expect(next(T0 + 2000)?.phase).toBe('leaderboard');
    expect(next(T0 + 3000)).toMatchObject({ questionIndex: 1, phase: 'question', answers: {} });
    expect(next(T0 + 4000)?.phase).toBe('reveal');
    expect(next(T0 + 5000)?.phase).toBe('leaderboard');
    expect(next(T0 + 6000)?.phase).toBe('podium');
    // The podium is the end: pressing on does nothing.
    expect(next(T0 + 7000)?.phase).toBe('podium');
  });

  it('keeps the scores across questions and forgets the answers', () => {
    let state = toQuizStage(withTwo(start())).state;
    state = run(
      state,
      { v: 1, type: 'student.quiz.answer', questionIndex: 0, optionIndex: 1 },
      T0 + 1000,
      'p1',
    ).state;
    state = run(state, { v: 1, type: 'teacher.quiz.next' }, T0 + 2000).state; // reveal
    state = run(state, { v: 1, type: 'teacher.quiz.next' }, T0 + 2100).state; // leaderboard
    state = run(state, { v: 1, type: 'teacher.quiz.next' }, T0 + 2200).state; // question 2
    expect(state.quiz?.answers).toEqual({});
    expect(state.quiz?.scores['p1']).toBe(975);
    state = run(
      state,
      { v: 1, type: 'student.quiz.answer', questionIndex: 1, optionIndex: 0 },
      T0 + 3200,
      'p1',
    ).state;
    expect(state.quiz?.scores['p1']).toBe(975 + 975);
  });

  it('ends with its stage and can be stopped by hand', () => {
    let state = toQuizStage(withTwo(start())).state;
    expect(state.quiz).not.toBeNull();
    state = run(state, { v: 1, type: 'teacher.quiz.finish' }, T0 + 1000).state;
    expect(state.quiz).toBeNull();

    state = toQuizStage(state).state;
    expect(state.quiz).not.toBeNull();
    state = run(state, { v: 1, type: 'teacher.stage.skip' }, T0 + 5000).state;
    expect(state.quiz).toBeNull();
  });

  it('is not started at all by a lesson without one', () => {
    const plain = reduce(
      withStudent(start()),
      {
        kind: 'command',
        role: 'teacher',
        participantId: null,
        message: { v: 1, type: 'teacher.quiz.start' },
        now: T0,
      },
      PLAN,
    );
    expect(plain.state.quiz).toBeNull();
  });
});

describe('screenshots of the practice (stage 3, H5)', () => {
  const requests = (messages: { type: string }[]) =>
    messages.filter((m) => m.type === 'screenshot.request') as {
      type: 'screenshot.request';
      targets: unknown;
      reason: string;
    }[];

  it('asks everybody once, five lesson minutes before the practice ends', () => {
    let state = teacher(start(), { v: 1, type: 'teacher.stage.set', index: 3 }, T0).state;
    // The practice lasts 22 minutes: nothing asked during the first 16.
    const early = tick(state, T0 + 16 * MS_PER_MIN);
    expect(requests(early.broadcast)).toHaveLength(0);
    state = early.state;

    const due = tick(state, T0 + 17 * MS_PER_MIN + 1000);
    expect(requests(due.broadcast)).toEqual([
      { v: 1, type: 'screenshot.request', targets: 'all', reason: 'before_end' },
    ]);
    expect(due.state.stage.shotRequested).toBe(true);

    // "+5 min" afterwards does not bring a second round.
    const extended = teacher(
      due.state,
      { v: 1, type: 'teacher.stage.extend', minutes: 5 },
      T0 + 18 * MS_PER_MIN,
    );
    expect(requests(tick(extended.state, T0 + 19 * MS_PER_MIN).broadcast)).toHaveLength(0);
  });

  it('asks again when the practice ends, however it ends', () => {
    const inPractice = teacher(start(), { v: 1, type: 'teacher.stage.set', index: 3 }, T0).state;
    const skipped = teacher(inPractice, { v: 1, type: 'teacher.stage.skip' }, T0 + MS_PER_MIN);
    expect(requests(skipped.broadcast)).toEqual([
      { v: 1, type: 'screenshot.request', targets: 'all', reason: 'stage_end' },
    ]);
    // Leaving the theory is no reason to photograph anything.
    const fromTheory = teacher(start(), { v: 1, type: 'teacher.stage.set', index: 2 }, T0).state;
    expect(
      requests(teacher(fromTheory, { v: 1, type: 'teacher.stage.skip' }, T0).broadcast),
    ).toHaveLength(0);
  });

  it('lets the teacher ask for chosen children, and only the teacher', () => {
    const asked = teacher(start(), { v: 1, type: 'teacher.screenshot', targets: ['p1'] }, T0);
    expect(requests(asked.broadcast)).toEqual([
      { v: 1, type: 'screenshot.request', targets: ['p1'], reason: 'manual' },
    ]);
    const byChild = student(withStudent(start()), {
      v: 1,
      type: 'teacher.screenshot',
      targets: 'all',
    });
    expect(requests(byChild.broadcast)).toHaveLength(0);
  });
});
