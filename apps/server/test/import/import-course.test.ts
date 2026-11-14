import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseSchema, LessonSchema } from '@sinf/shared';
import { importCourse } from '../../src/import/import-course.js';
import { authorFiles } from './helpers.js';

let dir: string;
let outDir: string;
let kidsFile: string;
let teacherFile: string;

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    result[path.slice(root.length + 1)] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  }
  return result;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sinf-import-'));
  outDir = join(dir, 'test-course');
  kidsFile = join(dir, 'kids.html');
  teacherFile = join(dir, 'teacher.html');
  const files = await authorFiles();
  await writeFile(kidsFile, files.kids);
  await writeFile(teacherFile, files.teacher);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('importCourse', () => {
  it('converts the author format into validated lessons, scenarios and media', async () => {
    const report = await importCourse({ kidsFile, teacherFile, outDir });
    expect(report.lessons).toBe(2);
    expect(report.screens).toEqual({ slide: 6, step: 2, type: 1, game: 2, total: 11 });
    expect(report.stagesFound).toBe(2);
    expect(report.media.files).toBe(2); // red and blue; the unused green picture is not written

    const g10 = LessonSchema.parse(
      JSON.parse(await readFile(join(outDir, 'lessons/g10.json'), 'utf8')),
    );
    expect(g10.group).toBe('gos');
    expect(g10.stages).toHaveLength(6);
    expect(g10.screens.map((s) => [s.kind, s.stage])).toEqual([
      ['slide', 'greeting'], // title slide → next screen's stage
      ['slide', 'greeting'],
      ['slide', 'theory'],
      ['type', 'practice'], // typing task right before the trainer
      ['game', 'practice'],
      ['game', 'practice'],
      ['slide', 'reflection'],
      ['slide', 'summary'],
    ]);
    const html = JSON.stringify(g10.screens);
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('data:image');
    expect(g10.media).toHaveLength(1);
    expect(g10.teacherScenario).toBe('/content/test-course/scenarios/g10.html');

    const k10 = LessonSchema.parse(
      JSON.parse(await readFile(join(outDir, 'lessons/k10.json'), 'utf8')),
    );
    expect(k10.group).toBe('krujok');
    expect(k10.screens.filter((s) => s.kind === 'step').map((s) => [s.step, s.level])).toEqual([
      [3, 2],
      [4, 'free'],
    ]);
    expect(k10.media).toHaveLength(2);

    const course = CourseSchema.parse(
      JSON.parse(await readFile(join(outDir, 'course.json'), 'utf8')),
    );
    expect(course.lessons.map((l) => l.id)).toEqual(['g10', 'k10']);
    expect(course.svgDefs).toContain('id="dsk"');
    expect(course.svgDefs).not.toContain('<image');

    const pics = await readFile(join(outDir, 'pics.json'), 'utf8');
    expect(pics).not.toContain('onload');

    const scenario = await readFile(join(outDir, 'scenarios/g10.html'), 'utf8');
    // Stage headings carry anchors, so the teacher panel can open the scenario at the current stage (S1.9).
    expect(scenario).toMatch(/<h3[^>]*id="stage-1"/);
    expect(scenario).toMatch(/<h3[^>]*id="stage-2"/);
    expect(scenario).not.toMatch(/<script|onclick|data:image|id="deck"|top-btns/);
    expect(scenario).toContain('/content/test-course/media/');
    expect(scenario).toContain('<style>h1{color:red}</style>');

    for (const url of [...g10.media, ...k10.media]) {
      await expect(
        readFile(join(outDir, url.replace('/content/test-course/', ''))),
      ).resolves.toBeDefined();
    }
  });

  it('gives byte-identical output on a repeated run and removes stale files', async () => {
    const first = await snapshot(outDir);
    await writeFile(join(outDir, 'media', 'stale.webp'), 'x');
    await importCourse({ kidsFile, teacherFile, outDir });
    expect(await snapshot(outDir)).toEqual(first);
  });

  it('rejects lessons that are missing in the teacher file', async () => {
    const files = await authorFiles();
    const teacher = files.teacher.replace(
      /<script type="application\/json" id="d-k10">.*?<\/script>/s,
      '',
    );
    const broken = join(dir, 'teacher-broken.html');
    await writeFile(broken, teacher);
    await expect(
      importCourse({ kidsFile, teacherFile: broken, outDir: join(dir, 'other') }),
    ).rejects.toThrow(/Lessons differ/);
  });
});
