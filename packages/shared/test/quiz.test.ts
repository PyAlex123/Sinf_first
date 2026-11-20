import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_QUIZ_LIMIT_SEC,
  MAX_QUIZ_OPTIONS,
  QuizSchema,
  scoreAnswer,
  QUIZ_OPTION_LETTERS,
} from '../src/quiz.js';

/** Points for one answer (S1.12): knowing it is worth twice what answering fast is worth. */
describe('scoring', () => {
  const limit = 20_000;

  it('gives nothing for a wrong answer, however fast', () => {
    expect(scoreAnswer(false, 0, limit)).toBe(0);
    expect(scoreAnswer(false, 19_000, limit)).toBe(0);
  });

  it('gives about a thousand at once and five hundred at the buzzer', () => {
    expect(scoreAnswer(true, 0, limit)).toBe(1000);
    expect(scoreAnswer(true, limit, limit)).toBe(500);
    expect(scoreAnswer(true, limit / 2, limit)).toBe(750);
  });

  it('never goes below five hundred or above a thousand', () => {
    for (const ms of [-100, 0, 1, 5_000, 19_999, 20_000, 50_000]) {
      const points = scoreAnswer(true, ms, limit);
      expect(points).toBeGreaterThanOrEqual(500);
      expect(points).toBeLessThanOrEqual(1000);
    }
  });

  it('rewards the quicker child', () => {
    expect(scoreAnswer(true, 2_000, limit)).toBeGreaterThan(scoreAnswer(true, 12_000, limit));
  });
});

describe('the quiz of lesson 10', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const quiz = QuizSchema.parse(
    JSON.parse(readFileSync(resolve(root, 'content/1-klass-2-chetvert/quizzes/g10.json'), 'utf8')),
  );
  const pics = JSON.parse(
    readFileSync(resolve(root, 'content/1-klass-2-chetvert/pics.json'), 'utf8'),
  ) as Record<string, string>;

  it('belongs to the lesson and fits on the screen of a first grader', () => {
    expect(quiz.lessonId).toBe('g10');
    expect(quiz.questions.length).toBeGreaterThanOrEqual(5);
    for (const question of quiz.questions) {
      expect(question.options.length).toBeLessThanOrEqual(MAX_QUIZ_OPTIONS);
      expect(question.options.length).toBeLessThanOrEqual(QUIZ_OPTION_LETTERS.length);
      expect(question.limitSec).toBe(DEFAULT_QUIZ_LIMIT_SEC);
      expect(question.correct).toBeLessThan(question.options.length);
    }
  });

  it('points only at pictures the course really has', () => {
    const missing = quiz.questions
      .flatMap((q) => q.options)
      .filter((o) => o.pic && !pics[o.pic])
      .map((o) => o.pic);
    expect(missing).toEqual([]);
  });
});
