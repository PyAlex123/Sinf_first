import { describe, expect, it } from 'vitest';
import {
  AuthoredLessonDocSchema,
  authoredToLesson,
  createSessionState,
  isRightAnswer,
  LessonSchema,
  questionProblem,
  QuestionBlockSchema,
  reduce,
  screenMaxStars,
  trainerMaxStars,
  type LessonPlan,
} from '../src/index.js';

/** W4 (PLAN.md 3.5): a teacher's test — questions, answers, stars. */

const id = `u-${'d'.repeat(32)}`;

describe('an answer', () => {
  it('to one choice or several must be exactly the right ones', () => {
    const single = { mode: 'single' as const, correct: [1], answers: [] };
    expect(isRightAnswer(single, { chosen: [1] })).toBe(true);
    expect(isRightAnswer(single, { chosen: [0] })).toBe(false);
    const multi = { mode: 'multi' as const, correct: [0, 2], answers: [] };
    expect(isRightAnswer(multi, { chosen: [2, 0] })).toBe(true);
    expect(isRightAnswer(multi, { chosen: [0] })).toBe(false);
    expect(isRightAnswer(multi, { chosen: [0, 1, 2] })).toBe(false);
  });

  it('typed, forgives case, spaces and ё, and nothing else', () => {
    const q = { mode: 'input' as const, correct: [], answers: ['Ёлка', 'Enter'] };
    expect(isRightAnswer(q, { typed: '  елка ' })).toBe(true);
    expect(isRightAnswer(q, { typed: 'ENTER' })).toBe(true);
    expect(isRightAnswer(q, { typed: 'ёлки' })).toBe(false);
    expect(isRightAnswer(q, { typed: '' })).toBe(false);
  });
});

describe('a question in the constructor', () => {
  it('says what it lacks before it can be asked', () => {
    const q = (v: unknown) =>
      QuestionBlockSchema.parse({ id: 'q', kind: 'question', ...(v as object) });
    expect(questionProblem(q({}))).toBe('text');
    expect(questionProblem(q({ text: 'Сколько?', options: [{ text: 'один' }] }))).toBe('options');
    expect(questionProblem(q({ text: 'Сколько?', options: [{ text: 'а' }, { text: 'б' }] }))).toBe(
      'correct',
    );
    expect(
      questionProblem(
        q({
          text: 'Сколько?',
          options: [
            { text: 'а', correct: true },
            { text: 'б', correct: true },
          ],
        }),
      ),
    ).toBe('correct');
    expect(questionProblem(q({ text: 'Клавиша?', mode: 'input', answers: [' '] }))).toBe('answers');
    expect(questionProblem(q({ text: 'Клавиша?', mode: 'input', answers: ['Enter'] }))).toBeNull();
  });

  it('becomes a numbered question screen; an unfinished one stays a slide', () => {
    const doc = AuthoredLessonDocSchema.parse({
      stages: [
        {
          key: 'theory',
          title: 'Тест',
          minutes: 10,
          place: 'computer',
          blocks: [
            { id: 'a', kind: 'question', text: 'Где Enter?', mode: 'input', answers: ['справа'] },
            {
              id: 'b',
              kind: 'question',
              text: 'Что вводит?',
              options: [{ text: 'мышь' }, { text: 'клавиатура', correct: true }],
            },
            { id: 'c', kind: 'question', text: 'Недописан' },
          ],
        },
      ],
    });
    const lesson = LessonSchema.parse(authoredToLesson({ id, title: 'Тест', topic: '', doc }));
    expect(lesson.screens.map((s) => s.kind)).toEqual(['question', 'question', 'slide']);
    const second = lesson.screens[1];
    expect(second?.kind === 'question' && [second.n, second.of, second.correct]).toEqual([
      2,
      3,
      [1],
    ]);
    expect(trainerMaxStars(lesson)).toBe(2);
  });
});

describe('the engine', () => {
  it('gives a screen no more stars than it holds', () => {
    const doc = AuthoredLessonDocSchema.parse({
      stages: [
        {
          key: 'theory',
          title: 'Тест',
          minutes: 10,
          place: 'computer',
          blocks: [
            { id: 's', kind: 'slide', title: 'Слайд' },
            {
              id: 'q',
              kind: 'question',
              text: 'Да?',
              options: [{ text: 'да', correct: true }, { text: 'нет' }],
            },
          ],
        },
      ],
    });
    const lesson = authoredToLesson({ id, title: 'Тест', topic: '', doc });
    const plan: LessonPlan = {
      stages: lesson.stages,
      screenStages: lesson.screens.map((s) => s.stage),
      stepScreens: [],
      quiz: null,
      screenMaxStars: lesson.screens.map(screenMaxStars),
    };
    let state = createSessionState({
      id: 's',
      lessonId: id,
      classId: 'c',
      screenCount: 2,
      now: 0,
      plan,
    });
    state = reduce(
      state,
      {
        kind: 'participant.join',
        participantId: 'p',
        number: 1,
        studentId: 'p',
        name: 'П',
        now: 0,
      },
      plan,
    ).state;
    state = reduce(
      state,
      {
        kind: 'command',
        role: 'student',
        participantId: 'p',
        message: { v: 1, type: 'teacher.mode.set', mode: 'free' },
        now: 0,
      },
      plan,
    ).state;
    const claim = (index: number) =>
      reduce(
        state,
        {
          kind: 'command',
          role: 'student',
          participantId: 'p',
          message: { v: 1, type: 'student.screen.done', index, stars: 3 },
          now: 1,
        },
        plan,
      ).state;
    expect(claim(0).participants['p']?.stars).toBe(0);
    expect(claim(1).participants['p']?.stars).toBe(1);
  });
});
