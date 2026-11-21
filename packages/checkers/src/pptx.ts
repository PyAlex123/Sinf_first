import type { PracticeCheck } from '@sinf/shared';
import { parseRels } from './rels.js';
import { verdict, type Verdict } from './verdict.js';
import {
  attr,
  descendants,
  first,
  fold,
  parseXml,
  relId,
  textContent,
  type Element,
} from './xml.js';
import { openOffice, relationships } from './zip.js';

/**
 * PowerPoint presentations (.pptx). What a real PowerPoint writes:
 * - the order of slides is the presentation's list (`sldIdLst`), not slide1, slide2, …;
 * - a title is a placeholder of type "title" or "ctrTitle"; an empty placeholder has no text;
 * - transitions may sit inside an "alternate content" block, for older PowerPoints;
 * - pictures are `p:pic`, tables and charts are graphic frames.
 */

type PptxCheck = Extract<PracticeCheck, { type: `pptx.${string}` }>;

interface Slide {
  title: string;
  text: string;
  pictures: number;
  tables: number;
  charts: number;
  transition: boolean;
  layout: string | null;
  notes: string;
}

export interface PptxModel {
  slides: Slide[];
}

const paragraphsText = (root: Element | undefined): string =>
  descendants(root, 'p')
    .map((p) => descendants(p, 't').map(textContent).join(''))
    .join('\n');

export function loadPptx(bytes: Uint8Array): PptxModel {
  const parts = openOffice(
    bytes,
    (n) =>
      n === 'ppt/presentation.xml' ||
      n === 'ppt/_rels/presentation.xml.rels' ||
      /^ppt\/slides\/(_rels\/)?slide[0-9]+\.xml(\.rels)?$/.test(n) ||
      /^ppt\/notesSlides\/notesSlide[0-9]+\.xml$/.test(n),
  );
  const presentation = parseXml(parts.get('ppt/presentation.xml') ?? '<presentation/>');
  const rels = relationships(parts, 'ppt/presentation.xml', parseRels);

  const slides: Slide[] = [];
  for (const id of descendants(first(presentation, 'sldIdLst'), 'sldId')) {
    const path = rels.get(relId(id) ?? '')?.target;
    const xml = path ? parts.get(path) : undefined;
    if (!path || !xml) continue;
    const doc = parseXml(xml);
    const shapes = descendants(doc, 'sp');
    const titleShape = shapes.find((sp) => {
      const type = attr(first(sp, 'ph'), 'type');
      return type === 'title' || type === 'ctrTitle';
    });
    const slideRels = relationships(parts, path, parseRels);
    let layout: string | null = null;
    let notes = '';
    for (const r of slideRels.values()) {
      if (r.type.endsWith('/slideLayout')) layout = r.target;
      if (r.type.endsWith('/notesSlide')) {
        const notesXml = parts.get(r.target);
        if (notesXml) {
          // The notes page also holds a picture of the slide and a slide number: only the body.
          notes = descendants(parseXml(notesXml), 'sp')
            .filter((sp) => attr(first(sp, 'ph'), 'type') === 'body')
            .map((sp) => paragraphsText(sp))
            .join('\n');
        }
      }
    }
    const frames = descendants(doc, 'graphicData');
    slides.push({
      title: paragraphsText(titleShape).trim(),
      text: paragraphsText(first(doc, 'cSld')),
      pictures: descendants(doc, 'pic').length,
      tables: frames.filter((g) => (attr(g, 'uri') ?? '').endsWith('/table')).length,
      charts: frames.filter((g) => (attr(g, 'uri') ?? '').endsWith('/chart')).length,
      transition: descendants(doc, 'transition').length > 0,
      layout,
      notes: notes.trim(),
    });
  }
  return { slides };
}

export function runPptx(m: PptxModel, check: PptxCheck): Verdict {
  const n = m.slides.length;
  switch (check.type) {
    case 'pptx.slides':
      return verdict(
        n >= check.min && (check.max === undefined || n <= check.max),
        `слайдов: ${n}`,
      );
    case 'pptx.titles': {
      if (check.slide !== undefined) {
        const slide = m.slides[check.slide - 1];
        return verdict(
          !!slide?.title,
          slide ? `заголовок: «${slide.title}»` : `нет слайда ${check.slide}`,
        );
      }
      const without = m.slides.filter((s) => !s.title).length;
      return verdict(n > 0 && without === 0, `слайдов без заголовка: ${without}`);
    }
    case 'pptx.image': {
      const pics = m.slides.reduce((sum, s) => sum + s.pictures, 0);
      return verdict(pics >= check.min, `картинок: ${pics}`);
    }
    case 'pptx.text': {
      const all = fold(m.slides.map((s) => s.text).join('\n'), check.caseSensitive);
      return verdict(all.includes(fold(check.contains, check.caseSensitive)), null);
    }
    case 'pptx.layouts': {
      const distinct = new Set(m.slides.map((s) => s.layout).filter((l) => l !== null)).size;
      return verdict(distinct >= check.min, `разных макетов: ${distinct}`);
    }
    case 'pptx.transitions': {
      const t = m.slides.filter((s) => s.transition).length;
      return verdict(t >= check.min, `слайдов с переходом: ${t}`);
    }
    case 'pptx.notes': {
      const t = m.slides.filter((s) => s.notes).length;
      return verdict(t >= check.min, `слайдов с заметками: ${t}`);
    }
    case 'pptx.table': {
      const t = m.slides.reduce((sum, s) => sum + s.tables, 0);
      return verdict(t >= check.min, `таблиц: ${t}`);
    }
    case 'pptx.chart': {
      const t = m.slides.reduce((sum, s) => sum + s.charts, 0);
      return verdict(t >= check.min, `диаграмм: ${t}`);
    }
  }
}
