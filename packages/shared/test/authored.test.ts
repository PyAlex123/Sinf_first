import { describe, expect, it } from 'vitest';
import {
  AuthoredLessonDocSchema,
  authoredCounts,
  authoredToLesson,
  escapeHtml,
  lessonAssetFiles,
  LessonSchema,
  standardLessonDoc,
} from '../src/index.js';

/** W1: a teacher's document in the author's format (ADR-019). */

const id = `u-${'a'.repeat(32)}`;

describe('a teacher’s lesson in the author’s format', () => {
  it('passes the author’s schema, stage by stage, screen by screen', () => {
    const doc = standardLessonDoc('Урок');
    const lesson = LessonSchema.parse(authoredToLesson({ id, title: 'Урок', topic: 'Тема', doc }));
    expect(lesson.stages.at(-1)?.endMin).toBe(45);
    expect(lesson.screens.map((s) => s.stage)).toEqual([
      'theory',
      'practice',
      'reflection',
      'summary',
    ]);
    expect(authoredCounts(doc)).toEqual({ minutes: 45, screens: 4 });
  });

  it('gives a stage without blocks its own cover, so the engine has a screen for it', () => {
    const doc = AuthoredLessonDocSchema.parse({
      stages: [
        { key: 'theory', title: 'Теория', minutes: 20, place: 'projector', blocks: [] },
        { key: 'practice', title: 'Практика', minutes: 25, place: 'computer' },
      ],
    });
    const lesson = authoredToLesson({ id, title: 'Пусто', topic: '', doc });
    expect(lesson.screens).toHaveLength(2);
    expect(lesson.screens[1]?.kind === 'slide' && lesson.screens[1].html).toContain(
      '<h1>Практика</h1>',
    );
  });

  it('never lets typed text become markup, in any field', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const doc = AuthoredLessonDocSchema.parse({
      stages: [
        {
          key: 'theory',
          title: evil.slice(0, 40),
          minutes: 10,
          place: 'projector',
          blocks: [{ id: 'a', kind: 'slide', title: evil, text: evil, bullets: [evil] }],
        },
      ],
    });
    const html = authoredToLesson({ id, title: evil, topic: '', doc })
      .screens.map((s) => (s.kind === 'slide' ? s.html : ''))
      .join('');
    expect(html).not.toContain('<img');
    expect(html).toContain(escapeHtml('<img src=x onerror=alert(1)>'));
  });

  it('lists the files a lesson names, once each', () => {
    const doc = standardLessonDoc('Урок');
    const image = { sha: 'b'.repeat(64), ext: 'webp' as const, width: 10, height: 10 };
    for (const s of doc.stages) {
      const block = s.blocks[0];
      if (block?.kind === 'slide') block.image = image;
    }
    expect(lessonAssetFiles(doc)).toEqual([`${'b'.repeat(64)}.webp`]);
  });

  it('shows a page of a PDF (a picture alone) as the whole slide', () => {
    const doc = AuthoredLessonDocSchema.parse({
      stages: [
        {
          key: 'theory',
          title: 'Теория',
          minutes: 10,
          place: 'projector',
          blocks: [
            {
              id: 'p1',
              kind: 'slide',
              image: { sha: 'c'.repeat(64), ext: 'webp', width: 1600, height: 900 },
            },
          ],
        },
      ],
    });
    const screen = authoredToLesson({ id, title: 'PDF', topic: '', doc }).screens[0];
    expect(screen?.kind === 'slide' && screen.html).toContain('viewBox="0 0 1600 900"');
    expect(screen?.kind === 'slide' && screen.html).not.toContain('<h1>');
  });
});
