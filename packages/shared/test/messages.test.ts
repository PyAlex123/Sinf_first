import { describe, expect, it } from 'vitest';
import { ClientMessageSchema, createSessionState, reduce, type LessonPlan } from '../src/index.js';

/** W6 (PLAN.md 4.5): a message to the class, and "open this screen for everybody". */

const plan: LessonPlan = {
  stages: [{ key: 'theory', title: 'Т', startMin: 0, endMin: 45, place: 'computer' }],
  screenStages: ['theory', 'theory', 'theory'],
  stepScreens: [],
  quiz: null,
};

function lesson() {
  let state = createSessionState({
    id: 's',
    lessonId: 'l',
    classId: 'c',
    screenCount: 3,
    now: 0,
    plan,
  });
  for (const id of ['a', 'b']) {
    state = reduce(
      state,
      { kind: 'participant.join', participantId: id, number: 1, studentId: id, name: id, now: 0 },
      plan,
    ).state;
  }
  return state;
}

describe('a message', () => {
  it('goes out to whom the teacher names, with a web link only', () => {
    const r = reduce(
      lesson(),
      {
        kind: 'command',
        role: 'teacher',
        participantId: null,
        message: {
          v: 1,
          type: 'teacher.message',
          targets: ['a'],
          text: 'Откройте учебник',
          url: 'https://example.org/x',
        },
        now: 7,
      },
      plan,
    );
    expect(r.broadcast).toEqual([
      {
        v: 1,
        type: 'message',
        id: 7,
        targets: ['a'],
        text: 'Откройте учебник',
        url: 'https://example.org/x',
      },
    ]);
    const bad = ClientMessageSchema.safeParse({
      v: 1,
      type: 'teacher.message',
      targets: 'all',
      text: 'x',
      url: 'javascript:alert(1)',
    });
    expect(bad.success).toBe(false);
  });

  it('is the teacher’s only', () => {
    const r = reduce(
      lesson(),
      {
        kind: 'command',
        role: 'student',
        participantId: 'a',
        message: { v: 1, type: 'teacher.message', targets: 'all', text: 'я учитель' },
        now: 1,
      },
      plan,
    );
    expect(r.broadcast).toEqual([]);
    expect(r.reply[0]).toMatchObject({ type: 'error' });
  });
});

describe('"open this screen for everybody"', () => {
  it('moves every child there, inside the stage', () => {
    const r = reduce(
      lesson(),
      {
        kind: 'command',
        role: 'teacher',
        participantId: null,
        message: { v: 1, type: 'teacher.screen.everyone', index: 2 },
        now: 1,
      },
      plan,
    );
    expect(Object.values(r.state.participants).map((p) => p.screenIndex)).toEqual([2, 2]);
    expect(r.broadcast).toContainEqual({ v: 1, type: 'screen.goto', index: 2 });
  });
});
