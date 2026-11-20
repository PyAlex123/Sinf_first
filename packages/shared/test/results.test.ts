import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRADE_THRESHOLDS,
  GradeThresholdsSchema,
  gradeFor,
  lessonDate,
  practiceStepCount,
  registerDate,
  scorePercent,
  trainerMaxStars,
  type Lesson,
} from '../src/index.js';

/** S1.13: stars → 2–5 and the lesson date, the parts of the journal that are pure arithmetic. */

describe('gradeFor', () => {
  it('follows the author’s thresholds: 90 → 5, 70 → 4, 50 → 3, below → 2', () => {
    const t = DEFAULT_GRADE_THRESHOLDS;
    expect(gradeFor(100, t)).toBe(5);
    expect(gradeFor(90, t)).toBe(5);
    expect(gradeFor(89, t)).toBe(4);
    expect(gradeFor(70, t)).toBe(4);
    expect(gradeFor(69, t)).toBe(3);
    expect(gradeFor(50, t)).toBe(3);
    expect(gradeFor(49, t)).toBe(2);
    expect(gradeFor(0, t)).toBe(2);
  });

  it('refuses thresholds that do not fall from 5 to 3', () => {
    expect(GradeThresholdsSchema.safeParse({ five: 90, four: 95, three: 50 }).success).toBe(false);
    expect(GradeThresholdsSchema.safeParse({ five: 80, four: 60, three: 40 }).success).toBe(true);
  });
});

describe('scorePercent', () => {
  const max = { trainer: 16, practice: 3, quiz: 6 };

  it('divides everything earned by everything possible', () => {
    // 12 + 2 + 4 = 18 of 25 → 72 %.
    expect(scorePercent({ trainerStars: 12, practiceStars: 2, quizCorrect: 4 }, max)).toBe(72);
    expect(scorePercent({ trainerStars: 16, practiceStars: 3, quizCorrect: 6 }, max)).toBe(100);
    expect(scorePercent({ trainerStars: 0, practiceStars: 0, quizCorrect: 0 }, max)).toBe(0);
  });

  it('leaves out a part that did not take place', () => {
    // No quiz asked, no stars for drawings: only the trainers count, 12 of 16 → 75 %.
    expect(
      scorePercent(
        { trainerStars: 12, practiceStars: 0, quizCorrect: 0 },
        { trainer: 16, practice: 0, quiz: 0 },
      ),
    ).toBe(75);
  });

  it('never goes above 100 and has no answer for an empty lesson', () => {
    expect(scorePercent({ trainerStars: 40, practiceStars: 3, quizCorrect: 9 }, max)).toBe(100);
    expect(
      scorePercent(
        { trainerStars: 0, practiceStars: 0, quizCorrect: 0 },
        { trainer: 0, practice: 0, quiz: 0 },
      ),
    ).toBeNull();
  });
});

describe('lesson maxima', () => {
  const screen = (kind: string, extra: object = {}) => ({ kind, ...extra });
  const lesson = {
    screens: [
      screen('slide'),
      screen('game', { level: { stars: 2 } }),
      screen('game', { level: { stars: 3 } }),
      screen('type'),
      screen('step'),
      screen('step'),
    ],
  } as unknown as Pick<Lesson, 'screens'>;

  it('counts the stars of every level and one per typed word', () => {
    expect(trainerMaxStars(lesson)).toBe(6);
  });

  it('counts the Paint steps', () => {
    expect(practiceStepCount(lesson)).toBe(2);
  });
});

describe('lessonDate', () => {
  it('uses the school clock: a lesson at 20:30 UTC is the next day in Tashkent', () => {
    expect(lessonDate('2026-11-20T20:30:00.000Z')).toBe('2026-11-21');
    expect(lessonDate('2026-11-20T03:00:00.000Z')).toBe('2026-11-20');
  });

  it('writes the date as a register does', () => {
    expect(registerDate('2026-11-05')).toBe('05.11.2026');
  });
});
