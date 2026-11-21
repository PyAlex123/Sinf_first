import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '../src/config.js';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/index.js';
import { testContent } from './helpers.js';

describe('loadContent', () => {
  it('loads the imported course with 14 lessons, and the sample practice', () => {
    const content = testContent();
    expect(content.courses.map((c) => c.id)).toEqual(['1-klass-2-chetvert', 'proba-praktiki']);
    // The sample practice of H16: a Word task with its template, checked at startup.
    expect(content.getPractice('proba-dokument')?.app).toBe('word');
    expect(content.templatePath('proba-dokument')).toMatch(/oformi-dokument\.docx$/);
    expect(content.getPractice('g10')).toBeUndefined();
    expect(content.getLesson('k10')?.group).toBe('krujok');
    expect(content.getCourseOf('g10')?.id).toBe('1-klass-2-chetvert');
    expect(content.getLesson('zzz')).toBeUndefined();
  });

  it('fails on a missing folder, an invalid course file or a folder/id mismatch', () => {
    expect(() => loadContent('/nonexistent/content')).toThrow(/not found/);
    const dir = mkdtempSync(join(tmpdir(), 'sinf-content-'));
    try {
      writeFileSync(join(dir, 'course.json'), '{}'); // not inside a course folder: ignored
      expect(loadContent(dir).courses).toEqual([]);

      mkdirSync(join(dir, 'bad-course'));
      writeFileSync(join(dir, 'bad-course', 'course.json'), JSON.stringify({ id: 'bad-course' }));
      expect(() => loadContent(dir)).toThrow();

      const good = JSON.parse(
        readFileSync(resolve(REPO_ROOT, 'content/1-klass-2-chetvert/course.json'), 'utf8'),
      ) as Record<string, unknown>;
      writeFileSync(join(dir, 'bad-course', 'course.json'), JSON.stringify(good));
      expect(() => loadContent(dir)).toThrow(/differs from folder name/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a practice whose template is outside its course or of another kind (H16)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sinf-content-'));
    try {
      cpSync(resolve(REPO_ROOT, 'content/proba-praktiki'), join(dir, 'proba-praktiki'), {
        recursive: true,
      });
      const file = join(dir, 'proba-praktiki', 'practice', 'proba-dokument.json');
      const task = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      expect(loadContent(dir).getPractice('proba-dokument')).toBeDefined();

      writeFileSync(file, JSON.stringify({ ...task, template: '../../etc/passwd' }));
      expect(() => loadContent(dir)).toThrow(/not in the course/);
      writeFileSync(file, JSON.stringify({ ...task, template: 'templates/missing.docx' }));
      expect(() => loadContent(dir)).toThrow(/not in the course/);
      writeFileSync(file, JSON.stringify({ ...task, fileName: 'Документ.xlsx' }));
      expect(() => loadContent(dir)).toThrow(/is not a file of word/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
