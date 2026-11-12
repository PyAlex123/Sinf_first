import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes as T } from 'parse5';
import {
  CourseSchema,
  courseUrl,
  LessonSchema,
  PicsSchema,
  SCREEN_KINDS,
  type Course,
  type GameLevel,
  type Lesson,
  type LessonGroup,
  type Screen,
  type ScreenKind,
  type StageKey,
} from '@sinf/shared';
import { find, findAll, getAttr, hasClass, removeNode, textContent } from './dom.js';
import { collectImageSources, linkImages, takeImageDefs, type ImageDef } from './images.js';
import { MediaStore } from './media.js';
import { hasActiveContent, isSafeCss, sanitizeTree } from './sanitize.js';
import { scopeCss } from './scope-css.js';
import { readKidsFile, readTeacherFile, type RawApp, type RawScreen } from './sources.js';
import { fillMissingStages, parseTimeline, screenStageKey } from './stages.js';

export interface ImportOptions {
  kidsFile: string;
  teacherFile: string;
  /** Output folder, e.g. `content/1-klass-2-chetvert`. Its name is the course id. */
  outDir: string;
}

export interface LessonReport {
  id: string;
  screens: number;
  media: number;
  mediaBytes: number;
}

export interface ImportReport {
  courseId: string;
  lessons: number;
  screens: Record<ScreenKind, number> & { total: number };
  /** Author's "slides" = our `slide` + `step` screens. */
  authorSlides: number;
  gameTypes: Record<string, number>;
  stagesFound: number;
  media: { files: number; bytes: number; sourceImages: number; sourceBytes: number };
  totalBytes: number;
  perLesson: LessonReport[];
}

/** Root class of the lesson player; the author's stylesheet is scoped under it. */
export const LESSON_ROOT_CLASS = '.lesson-root';

/** Files and folders the import owns inside the output folder; they are recreated on every run. */
const MANAGED = [
  'course.json',
  'pics.json',
  'lesson.css',
  'import-report.json',
  'lessons',
  'scenarios',
  'media',
];

interface PreparedScreen {
  raw: RawScreen;
  tree?: T.DocumentFragment;
}

interface PreparedLesson {
  app: RawApp;
  screens: PreparedScreen[];
  scenario: T.Document;
  scenarioImages: Map<string, ImageDef>;
}

export async function importCourse(options: ImportOptions): Promise<ImportReport> {
  const courseId = basename(options.outDir);
  if (!/^[a-z0-9-]+$/.test(courseId)) {
    throw new Error(
      `Output folder name "${courseId}" must be a course id: lowercase latin letters, digits, dashes`,
    );
  }
  const kids = readKidsFile(await readFile(options.kidsFile, 'utf8'));
  const teacher = readTeacherFile(await readFile(options.teacherFile, 'utf8'));
  checkSameLessons(kids.apps, teacher.lessonIds, [...teacher.scenarios.keys()]);
  if (!isSafeCss(kids.css)) {
    throw new Error('Children file: stylesheet imports or loads external resources');
  }

  // 1. Parse everything and collect the pictures that are actually used.
  const prepared: PreparedLesson[] = kids.apps.map((app) => {
    const scenarioHtml = teacher.scenarios.get(app.id);
    if (!scenarioHtml) throw new Error(`No teacher scenario for lesson ${app.id}`);
    const scenario = parse(scenarioHtml);
    removeDuplicatePresentation(scenario);
    return {
      app,
      screens: app.screens.map((raw) =>
        raw.t === 'slide' ? { raw, tree: parseFragment(raw.html) } : { raw },
      ),
      scenario,
      scenarioImages: takeImageDefs(scenario),
    };
  });
  const media = new MediaStore(courseId);
  await media.prepare(
    prepared.flatMap((p) => [
      ...p.screens.flatMap((s) => (s.tree ? collectImageSources(s.tree, kids.images) : [])),
      ...collectImageSources(p.scenario, p.scenarioImages),
    ]),
  );

  // 2. Build lessons and scenarios.
  const lessons: Lesson[] = [];
  const scenarios = new Map<string, string>();
  for (const p of prepared) {
    const stages = parseTimeline(p.scenario);
    linkImages(p.scenario, p.scenarioImages, media);
    sanitizeTree(p.scenario);
    scenarios.set(p.app.id, serialize(p.scenario));

    const stageKeys = fillMissingStages(p.screens.map(rawStage));
    const urls: string[] = [];
    const screens = p.screens.map((s, i): Screen => {
      const stage = stageKeys[i] as StageKey;
      if (s.raw.t === 'game') {
        checkPics(s.raw.lv, kids.pics, `${p.app.id} screen ${i + 1}`);
        return { kind: 'game', stage, n: s.raw.n, level: s.raw.lv };
      }
      if (s.raw.t === 'type') {
        return {
          kind: 'type',
          stage,
          question: s.raw.q,
          pic: cleanMarkup(s.raw.pic),
          word: s.raw.word,
          n: s.raw.n,
          of: s.raw.of,
        };
      }
      const tree = s.tree as T.DocumentFragment;
      const step = s.raw.cls === 'step' ? stepInfo(tree) : undefined;
      urls.push(...linkImages(tree, kids.images, media));
      sanitizeTree(tree);
      const html = serialize(tree);
      if (step) {
        return { kind: 'step', stage, ...step, html };
      }
      if (s.raw.cls !== 'title' && s.raw.cls !== 'text' && s.raw.cls !== 'text wide') {
        throw new Error(`${p.app.id} screen ${i + 1}: unknown slide class "${s.raw.cls}"`);
      }
      return { kind: 'slide', stage, layout: s.raw.cls, html };
    });

    lessons.push(
      LessonSchema.parse({
        id: p.app.id,
        group: lessonGroup(p.app.group),
        num: p.app.num,
        title: p.app.title,
        sub: p.app.sub,
        icon: cleanMarkup(p.app.icon),
        stages,
        screens,
        teacherScenario: courseUrl(courseId, `scenarios/${p.app.id}.html`),
        media: [...new Set(urls)],
      }),
    );
  }

  const pics = PicsSchema.parse(
    Object.fromEntries(Object.entries(kids.pics).map(([key, svg]) => [key, cleanMarkup(svg)])),
  );
  const course: Course = CourseSchema.parse({
    id: courseId,
    title: kids.title,
    lessons: lessons.map((l) => ({
      id: l.id,
      group: l.group,
      num: l.num,
      title: l.title,
      sub: l.sub,
      icon: l.icon,
      screens: l.screens.length,
    })),
    abc: kids.abc,
    abcColors: kids.abcColors,
    svgDefs: kids.svgDefsRoot ? cleanMarkup(serialize(kids.svgDefsRoot)) : '',
    styles: courseUrl(courseId, 'lesson.css'),
    pics: courseUrl(courseId, 'pics.json'),
  });

  // 3. Write. Output is deterministic: same sources → byte-identical files.
  const files = new Map<string, string | Buffer>();
  files.set('course.json', json(course));
  files.set('pics.json', json(pics));
  // The author's CSS is global (body, #stage, .bar…); the player loads it scoped under `.lesson-root`.
  files.set('lesson.css', scopeCss(kids.css, LESSON_ROOT_CLASS));
  for (const lesson of lessons) files.set(`lessons/${lesson.id}.json`, json(lesson));
  for (const [id, html] of scenarios) files.set(`scenarios/${id}.html`, html);
  for (const file of media.files()) files.set(`media/${file.name}`, file.bytes);

  const report = buildReport(courseId, lessons, media, files);
  files.set('import-report.json', json(report));

  await Promise.all(
    MANAGED.map((name) => rm(join(options.outDir, name), { recursive: true, force: true })),
  );
  for (const dir of ['lessons', 'scenarios', 'media']) {
    await mkdir(join(options.outDir, dir), { recursive: true });
  }
  for (const [name, data] of files) {
    await writeFile(join(options.outDir, name), data);
  }
  return report;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function checkSameLessons(apps: RawApp[], listed: string[], scenarioIds: string[]): void {
  const ids = apps
    .map((a) => a.id)
    .sort()
    .join(',');
  if (ids !== [...listed].sort().join(',') || ids !== [...scenarioIds].sort().join(',')) {
    throw new Error(
      `Lessons differ between files: children [${ids}], teacher list [${listed.join(',')}], ` +
        `scenarios [${scenarioIds.join(',')}]`,
    );
  }
  if (new Set(apps.map((a) => a.id)).size !== apps.length) {
    throw new Error('Duplicate lesson ids in the children file');
  }
}

function lessonGroup(group: string): LessonGroup {
  if (group.startsWith('Кружок')) return 'krujok';
  if (group === 'Информатика') return 'gos';
  throw new Error(`Unknown lesson group "${group}"`);
}

/** Stage written on the screen itself, or `null` (title slides, typing tasks). */
function rawStage(screen: PreparedScreen): StageKey | null {
  if (screen.raw.t === 'game') return screenStageKey(screen.raw.stage);
  if (!screen.tree) return null;
  const label = find(screen.tree, (el) => hasClass(el, 's-stage'));
  return label ? screenStageKey(textContent(label)) : null;
}

/** "Шаг 3" and the difficulty mark `<span class="stars">★★</span>` / `<span class="stars free">`. */
function stepInfo(tree: T.DocumentFragment): {
  step: number | null;
  level: 1 | 2 | 3 | 'free' | null;
} {
  const num = find(tree, (el) => hasClass(el, 's-num'));
  const stepMatch = num ? /Шаг\s*(\d+)/i.exec(textContent(num)) : null;
  const stars = find(tree, (el) => hasClass(el, 'stars'));
  let level: 1 | 2 | 3 | 'free' | null = null;
  if (stars && hasClass(stars, 'free')) {
    level = 'free';
  } else if (stars) {
    const count = [...textContent(stars)].filter((ch) => ch === '★').length;
    if (count === 1 || count === 2 || count === 3) level = count;
  }
  return { step: stepMatch?.[1] ? Number(stepMatch[1]) : null, level };
}

/** Sanitizes inline markup that must not reference images (icons, PICS, typing pictures). */
function cleanMarkup(markup: string): string {
  const tree = parseFragment(markup);
  sanitizeTree(tree);
  if (hasActiveContent(tree)) {
    throw new Error('Markup still has active content after sanitizing');
  }
  return serialize(tree);
}

/** The scenario embeds a copy of the children's slides (#deck) and buttons that need scripts. */
function removeDuplicatePresentation(doc: T.Document): void {
  for (const el of findAll(doc, (e) => getAttr(e, 'id') === 'deck' || hasClass(e, 'top-btns'))) {
    if (el.parentNode) removeNode(el);
  }
}

function checkPics(level: GameLevel, pics: Record<string, string>, where: string): void {
  const keys: string[] = [...(level.show ?? [])];
  if (level.pic) keys.push(level.pic);
  if (level.type === 'story') keys.push(...level.cards);
  if (level.type === 'pick')
    for (const [kind, value] of level.opts) if (kind === 'pic') keys.push(value);
  if (level.type === 'groups') for (const g of level.groups) keys.push(...g.keys);
  const missing = keys.filter((k) => !(k in pics));
  if (missing.length > 0) {
    throw new Error(`${where}: unknown pictures ${missing.join(', ')}`);
  }
}

function buildReport(
  courseId: string,
  lessons: Lesson[],
  media: MediaStore,
  files: Map<string, string | Buffer>,
): ImportReport {
  const screens = Object.fromEntries(SCREEN_KINDS.map((k) => [k, 0])) as Record<ScreenKind, number>;
  const gameTypes: Record<string, number> = {};
  for (const lesson of lessons) {
    for (const screen of lesson.screens) {
      screens[screen.kind]++;
      if (screen.kind === 'game')
        gameTypes[screen.level.type] = (gameTypes[screen.level.type] ?? 0) + 1;
    }
  }
  const mediaFiles = media.files();
  const sizeOf = new Map(
    mediaFiles.map((f) => [courseUrl(courseId, `media/${f.name}`), f.bytes.length]),
  );
  const total = Object.values(screens).reduce((a, b) => a + b, 0);
  return {
    courseId,
    lessons: lessons.length,
    screens: { ...screens, total },
    authorSlides: screens.slide + screens.step,
    gameTypes: Object.fromEntries(Object.entries(gameTypes).sort(([a], [b]) => a.localeCompare(b))),
    stagesFound: lessons.filter((l) => l.stages.length > 0).length,
    media: {
      files: mediaFiles.length,
      bytes: mediaFiles.reduce((sum, f) => sum + f.bytes.length, 0),
      sourceImages: mediaFiles.length,
      sourceBytes: mediaFiles.reduce((sum, f) => sum + f.sourceBytes, 0),
    },
    totalBytes: [...files.values()].reduce((sum, data) => sum + Buffer.byteLength(data), 0),
    perLesson: lessons.map((l) => ({
      id: l.id,
      screens: l.screens.length,
      media: l.media.length,
      mediaBytes: l.media.reduce((sum, url) => sum + (sizeOf.get(url) ?? 0), 0),
    })),
  };
}
