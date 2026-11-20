import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CourseSchema, LessonSchema, PicsSchema, type Lesson } from '@sinf/shared';

/**
 * Acceptance checks of STAGE1.md S1.2 on the imported course committed in content/.
 * Re-run `pnpm import:html …` (see CLAUDE.md §10) if the sources in content-src/ change.
 */
const COURSE = '1-klass-2-chetvert';
const root = resolve(import.meta.dirname, '../../../content', COURSE);
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const fileOfUrl = (url: string): string => join(root, url.replace(`/content/${COURSE}/`, ''));

const course = CourseSchema.parse(JSON.parse(read('course.json')));
const lessons: Lesson[] = course.lessons.map((l) =>
  LessonSchema.parse(JSON.parse(read(`lessons/${l.id}.json`))),
);
const urlsIn = (text: string): string[] =>
  text.match(/\/content\/[a-z0-9-]+\/media\/[0-9a-f]+\.webp/g) ?? [];

describe(`imported course ${COURSE}`, () => {
  it('has 14 lessons and 419 screens: 315 slides, 43 typing tasks, 61 trainer levels', () => {
    expect(lessons).toHaveLength(14);
    const screens = lessons.flatMap((l) => l.screens);
    const count = (kind: string): number => screens.filter((s) => s.kind === kind).length;
    expect(screens).toHaveLength(419);
    expect(count('slide') + count('step')).toBe(315);
    expect(count('type')).toBe(43);
    expect(count('game')).toBe(61);
    expect(lessons.filter((l) => l.group === 'gos').map((l) => l.id)).toEqual([
      'g10',
      'g11',
      'g12',
      'g13',
      'g14',
      'g15',
      'g16',
    ]);
    expect(lessons.filter((l) => l.group === 'krujok').map((l) => l.id)).toEqual([
      'k10',
      'k11',
      'k12',
      'k13',
      'k14',
      'k15',
      'k16',
    ]);
  });

  it('has the timing of all 14 lessons: 45 minutes, 6 stages, practice 9 + rest 4 + 9', () => {
    for (const lesson of lessons) {
      expect(lesson.stages.map((s) => s.key)).toEqual([
        'greeting',
        'goal',
        'theory',
        'practice',
        'reflection',
        'summary',
      ]);
      expect(lesson.stages.at(-1)?.endMin).toBe(45);
      const practice = lesson.stages.find((s) => s.key === 'practice');
      expect(practice?.parts?.map((p) => p.kind)).toEqual(['work', 'rest', 'work']);
    }
  });

  it('opening a lesson loads only its own pictures', () => {
    for (const lesson of lessons) {
      const raw = read(`lessons/${lesson.id}.json`);
      expect(raw).not.toContain('data:image');
      expect(new Set(urlsIn(raw))).toEqual(new Set(lesson.media));
      for (const url of lesson.media) expect(existsSync(fileOfUrl(url)), url).toBe(true);
    }
    expect(read('course.json')).not.toContain('data:image');
    expect(read('pics.json')).not.toContain('data:image');
  });

  it('keeps every picture within the budget: WebP, at most 150 KB', () => {
    for (const name of readdirSync(join(root, 'media'))) {
      expect(name).toMatch(/^[0-9a-f]{16}\.webp$/);
      expect(readFileSync(join(root, 'media', name)).length).toBeLessThanOrEqual(150 * 1024);
    }
  });

  it('has sanitized teacher scenarios with existing pictures', () => {
    for (const lesson of lessons) {
      const html = readFileSync(fileOfUrl(lesson.teacherScenario), 'utf8');
      expect(html).not.toMatch(/<script|\son[a-z]+=|data:image|javascript:/i);
      for (const url of urlsIn(html)) expect(existsSync(fileOfUrl(url)), url).toBe(true);
    }
  });

  it('has no scripts or event handlers in lessons', () => {
    for (const lesson of lessons) {
      expect(read(`lessons/${lesson.id}.json`)).not.toMatch(/<script|\son[a-z]+=\\"|javascript:/i);
    }
  });

  it('has valid pictures for the trainer', () => {
    const pics = PicsSchema.parse(JSON.parse(read('pics.json')));
    expect(Object.keys(pics)).toHaveLength(115);
  });
});
