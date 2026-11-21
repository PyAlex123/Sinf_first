import { describe, expect, it } from 'vitest';
import {
  checkState,
  createSessionState,
  isPracticeFile,
  PracticeTaskSchema,
  practiceScore,
  reduce,
  scorePercent,
  type CheckReport,
} from '../src/index.js';

/** H16: a practice in a real program as the lesson and its results see it. */

const task = PracticeTaskSchema.parse({
  app: 'word',
  fileName: 'Оформи документ.docx',
  criteria: [
    {
      id: 'title',
      kind: 'auto',
      label: { ru: 'Заголовок', uz: 'Sarlavha' },
      points: 2,
      check: { type: 'docx.headings', level: 1 },
    },
    {
      id: 'font',
      kind: 'auto',
      label: { ru: 'Шрифт', uz: 'Shrift' },
      points: 3,
      check: { type: 'docx.font', sizePt: 14 },
    },
    { id: 'neat', kind: 'manual', label: { ru: 'Аккуратно', uz: 'Ozoda' }, points: 5 },
  ],
});

const report: CheckReport = {
  file: 'ok',
  results: [
    { id: 'title', outcome: 'pass', found: null },
    { id: 'font', outcome: 'unknown', found: null },
  ],
  autoScore: 2,
  autoMax: 5,
  ms: 3,
};

describe('the practice file', () => {
  it('is any file of the program’s kind, whatever its name', () => {
    expect(isPracticeFile(task, 'Оформи документ.docx')).toBe(true);
    expect(isPracticeFile(task, 'мой.DOCX')).toBe(true);
    expect(isPracticeFile(task, 'Рисунок.png')).toBe(false);
    expect(isPracticeFile(task, 'docx')).toBe(false);
  });
});

describe('practice points', () => {
  it('count what passed; an undecided or unmarked criterion counts nothing yet', () => {
    expect(practiceScore(task, report, {})).toEqual({
      outcomes: { title: 'pass', font: 'unknown', neat: 'unknown' },
      points: 2,
      max: 10,
    });
  });

  it('let the teacher’s mark decide over the checker', () => {
    expect(practiceScore(task, report, { font: true, neat: true, title: false })).toEqual({
      outcomes: { title: 'fail', font: 'pass', neat: 'pass' },
      points: 8,
      max: 10,
    });
  });

  it('work for a child who saved nothing', () => {
    expect(practiceScore(task, null, { neat: true }).points).toBe(5);
  });

  it('weigh like stars in the lesson’s share', () => {
    const max = { trainer: 10, practice: 0, quiz: 0, check: 10 };
    expect(
      scorePercent({ trainerStars: 10, practiceStars: 0, quizCorrect: 0, checkPoints: 5 }, max),
    ).toBe(75);
    // A lesson before H16 knows nothing of the practice: nothing changes for it.
    expect(
      scorePercent(
        { trainerStars: 5, practiceStars: 0, quizCorrect: 0 },
        { trainer: 10, practice: 0, quiz: 0 },
      ),
    ).toBe(50);
  });
});

describe('a checked save in the lesson', () => {
  it('reaches the child’s tile, and only that child’s', () => {
    let state = createSessionState({
      id: 's',
      lessonId: 'proba-dokument',
      classId: 'c',
      screenCount: 3,
      now: 0,
    });
    for (const id of ['a', 'b']) {
      state = reduce(state, {
        kind: 'participant.join',
        participantId: id,
        number: 1,
        studentId: id,
        name: id,
        now: 0,
      }).state;
    }
    const check = checkState(task, 'Оформи документ.docx', report, 5);
    expect(check).toMatchObject({ passed: 1, total: 2, outcomes: { title: 'pass' } });
    const r = reduce(state, { kind: 'practice.checked', participantId: 'a', check, now: 5 });
    expect(r.state.participants['a']?.check).toEqual(check);
    expect(r.state.participants['b']?.check).toBeNull();
    expect(r.broadcast).toEqual([expect.objectContaining({ type: 'participant.updated' })]);
    // Nobody left to tell: a stray check changes nothing.
    expect(
      reduce(state, { kind: 'practice.checked', participantId: 'x', check, now: 5 }).broadcast,
    ).toEqual([]);
  });
});
