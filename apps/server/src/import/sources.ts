import { parse, type DefaultTreeAdapterTypes as T } from 'parse5';
import { z } from 'zod';
import { GameLevelSchema } from '@sinf/shared';
import { find, findAll, getAttr, textContent } from './dom.js';
import { takeImageDefs, type ImageDef } from './images.js';
import { extractJsonAssignment } from './json-literal.js';

/** Input format of the author's files (STAGE1.md §2). Strict: an unknown field means the format has changed. */

const RawSlideSchema = z.strictObject({
  t: z.literal('slide'),
  cls: z.string(),
  html: z.string().min(1),
});
const RawTypeSchema = z.strictObject({
  t: z.literal('type'),
  q: z.string().min(1),
  pic: z.string().min(1),
  word: z.string().min(1),
  n: z.number().int().positive(),
  of: z.number().int().positive(),
});
const RawGameSchema = z.strictObject({
  t: z.literal('game'),
  lv: GameLevelSchema,
  n: z.number().int().positive(),
  stage: z.string().min(1),
});
export const RawScreenSchema = z.discriminatedUnion('t', [
  RawSlideSchema,
  RawTypeSchema,
  RawGameSchema,
]);
export type RawScreen = z.infer<typeof RawScreenSchema>;

export const RawAppSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  group: z.string().min(1),
  num: z.number().int().positive(),
  title: z.string().min(1),
  sub: z.string(),
  icon: z.string().min(1),
  teacher: z.string(),
  screens: z.array(RawScreenSchema).min(1),
});
export type RawApp = z.infer<typeof RawAppSchema>;

export interface KidsSource {
  title: string;
  apps: RawApp[];
  pics: Record<string, string>;
  abc: string[];
  abcColors: string[];
  /** The author's stylesheet. */
  css: string;
  /** Shared non-image SVG definitions (patterns, gradients, clip paths), serialized. */
  svgDefsRoot: T.Element | undefined;
  /** Base64 screenshots from the hidden `<defs>`, by id. */
  images: Map<string, ImageDef>;
}

/** Parses the children's file `1_klass_2_chetvert.html`. No code from the file is executed. */
export function readKidsFile(html: string): KidsSource {
  const doc = parse(html);
  const script = findAll(doc, (el) => el.tagName === 'script' && !getAttr(el, 'src')).find((el) =>
    /\bAPPS\s*=/.test(textContent(el)),
  );
  if (!script) {
    throw new Error('Children file: script with APPS not found');
  }
  const code = textContent(script);
  const title = z.string().min(1).parse(extractJsonAssignment(code, 'TITLE'));
  const apps = z.array(RawAppSchema).min(1).parse(extractJsonAssignment(code, 'APPS'));
  const pics = z.record(z.string(), z.string().min(1)).parse(extractJsonAssignment(code, 'PICS'));
  const abc = z.array(z.string().min(1)).parse(extractJsonAssignment(code, 'ABC'));
  const abcColors = z.array(z.string().min(1)).parse(extractJsonAssignment(code, 'ABCC'));

  const css = findAll(doc, (el) => el.tagName === 'style')
    .map(textContent)
    .join('\n');
  const images = takeImageDefs(doc);
  const svgDefsRoot = find(doc, (el) => el.tagName === 'defs');
  return { title, apps, pics, abc, abcColors, css, svgDefsRoot, images };
}

export interface TeacherSource {
  /** Lesson ids listed in the teacher file (`const IT = [...]`). */
  lessonIds: string[];
  /** Full HTML document of each lesson scenario, by lesson id. */
  scenarios: Map<string, string>;
}

/** Parses the teacher file `1_klass_2_chetvert_uchitel.html`. */
export function readTeacherFile(html: string): TeacherSource {
  const doc = parse(html);
  const scenarios = new Map<string, string>();
  for (const el of findAll(
    doc,
    (e) => e.tagName === 'script' && getAttr(e, 'type') === 'application/json',
  )) {
    const id = getAttr(el, 'id');
    if (!id?.startsWith('d-')) continue;
    scenarios.set(
      id.slice(2),
      z
        .string()
        .min(1)
        .parse(JSON.parse(textContent(el))),
    );
  }
  const listScript = findAll(doc, (el) => el.tagName === 'script' && !getAttr(el, 'type')).find(
    (el) => /\bIT\s*=/.test(textContent(el)),
  );
  if (!listScript) {
    throw new Error('Teacher file: script with IT not found');
  }
  const list = z
    .array(z.looseObject({ id: z.string().min(1) }))
    .parse(extractJsonAssignment(textContent(listScript), 'IT'));
  return { lessonIds: list.map((l) => l.id), scenarios };
}
