// Copies the lesson content needed by the standalone demo page into dist-demo/content.
// Files are copied unchanged, so they still match the shared schemas; the demo loader turns the
// absolute /content/<course>/ URLs into relative ones after validating them.
// Usage: node scripts/build-demo-content.mjs <lessonId…>
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const LESSONS = process.argv.slice(2);
if (LESSONS.length === 0) {
  console.error('Usage: node scripts/build-demo-content.mjs g10 k10');
  process.exit(1);
}

const repo = resolve(import.meta.dirname, '../../..');
const course = '1-klass-2-chetvert';
const src = resolve(repo, 'content', course);
const out = resolve(import.meta.dirname, '../dist-demo/content');
mkdirSync(resolve(out, 'lessons'), { recursive: true });
mkdirSync(resolve(out, 'media'), { recursive: true });

/** @type {{ lessons: { id: string }[] }} */
const courseJson = JSON.parse(readFileSync(resolve(src, 'course.json'), 'utf8'));
courseJson.lessons = courseJson.lessons.filter((lesson) => LESSONS.includes(lesson.id));
writeFileSync(resolve(out, 'course.json'), JSON.stringify(courseJson));

copyFileSync(resolve(src, 'pics.json'), resolve(out, 'pics.json'));
copyFileSync(resolve(src, 'lesson.css'), resolve(out, 'lesson.css'));

let media = 0;
let bytes = 0;
for (const id of LESSONS) {
  const raw = readFileSync(resolve(src, 'lessons', `${id}.json`), 'utf8');
  /** @type {{ media: string[] }} */
  const lesson = JSON.parse(raw);
  for (const url of lesson.media) {
    const name = basename(url);
    const file = resolve(src, 'media', name);
    copyFileSync(file, resolve(out, 'media', name));
    media += 1;
    bytes += readFileSync(file).length;
  }
  writeFileSync(resolve(out, 'lessons', `${id}.json`), raw);
}

// Screenshots of the server-side screens shown on the demo page.
const shotsSrc = resolve(repo, 'docs/screenshots');
const shotsOut = resolve(import.meta.dirname, '../dist-demo/shots');
mkdirSync(shotsOut, { recursive: true });
let shots = 0;
for (const name of readdirSync(shotsSrc)) {
  if (!name.endsWith('.png')) continue;
  copyFileSync(resolve(shotsSrc, name), resolve(shotsOut, name));
  shots += 1;
}

// The artifact entry must be index.html.
copyFileSync(
  resolve(import.meta.dirname, '../dist-demo/demo.html'),
  resolve(import.meta.dirname, '../dist-demo/index.html'),
);

console.log(
  `demo content: ${LESSONS.length} lessons, ${media} images, ${Math.round(bytes / 1024)} KB, ${shots} screenshots`,
);
