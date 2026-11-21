import { describe, expect, it } from 'vitest';
import { emaktabDue, emaktabUntil, JournalSchema } from '../src/index.js';

/** W12: the 72 hours of eMaktab. */

describe('eMaktab’s 72 hours', () => {
  it('end three days after the start of the lesson’s day in Tashkent', () => {
    // 20 November 00:00 in Tashkent is 19 November 19:00 UTC.
    expect(emaktabUntil('2026-11-20').toISOString()).toBe('2026-11-22T19:00:00.000Z');
  });

  const journal = JournalSchema.parse({
    class: {
      id: 'c',
      name: '1А',
      starsToGrade: true,
      thresholds: { five: 90, four: 70, three: 50 },
    },
    lessons: [
      {
        kind: 'manual',
        sessionId: null,
        columnId: 'a',
        lessonId: null,
        lessonTitle: 'Устно',
        date: '2026-11-18',
      },
      {
        kind: 'manual',
        sessionId: null,
        columnId: 'b',
        lessonId: null,
        lessonTitle: 'Тест',
        date: '2026-11-20',
      },
      {
        kind: 'manual',
        sessionId: null,
        columnId: 'c',
        lessonId: null,
        lessonTitle: 'Пусто',
        date: '2026-11-20',
      },
      {
        kind: 'manual',
        sessionId: null,
        columnId: 'd',
        lessonId: null,
        lessonTitle: 'Готово',
        date: '2026-11-20',
        emaktabAt: '2026-11-20T10:00:00.000Z',
      },
    ],
    students: [
      {
        id: 's',
        name: 'Алиев Тимур',
        isActive: true,
        isVirtual: false,
        cells: [5, 4, null, 3].map((grade) => ({
          present: true,
          stars: 0,
          grade,
          confirmed: true,
          comment: null,
        })),
      },
    ],
  });

  it('remind of columns with grades, not marked, while there is time', () => {
    const now = new Date('2026-11-21T09:00:00.000Z');
    // The 18th is past its 72 hours; "Пусто" has no grades; "Готово" is marked.
    expect(emaktabDue(journal, now)).toEqual([{ index: 1, grades: 1, hoursLeft: 34 }]);
    expect(emaktabDue({ ...journal, emaktab: false }, now)).toEqual([]);
  });
});
