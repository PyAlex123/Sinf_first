import { unzipSync } from 'fflate';
import { parseRels } from './rels.js';
import { attr, descendants, first, parseXml, relId, textContent, type Element } from './xml.js';
import { openOffice, relationships } from './zip.js';

/**
 * The slides of a PowerPoint file as plain content (stage 6, B4): the title, the paragraphs of the
 * text boxes and the first picture of every slide, in the presentation's order. The lesson builder
 * makes its own slides of them; the look of PowerPoint is not copied (ADR-019, addendum B4).
 */

export interface ReadSlide {
  title: string;
  /** Non-empty paragraphs of the other text boxes, top to bottom as they were written. */
  paragraphs: string[];
  /** The first picture the browser can show; a vector picture (EMF, WMF) is left out. */
  picture: { bytes: Uint8Array; ext: string } | null;
}

/** A presentation of more slides than a lesson stage holds is cut, not refused. */
const MAX_SLIDES = 60;
const PICTURE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
/** The slide number, the date and the footer are not content. */
const SKIPPED = new Set(['sldNum', 'dt', 'ftr']);

const paragraphs = (root: Element | undefined): string[] =>
  descendants(root, 'p')
    .map((p) => descendants(p, 't').map(textContent).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export function readSlides(bytes: Uint8Array): ReadSlide[] {
  const parts = openOffice(
    bytes,
    (n) =>
      n === 'ppt/presentation.xml' ||
      n === 'ppt/_rels/presentation.xml.rels' ||
      /^ppt\/slides\/(_rels\/)?slide[0-9]+\.xml(\.rels)?$/.test(n),
  );
  const presentation = parseXml(parts.get('ppt/presentation.xml') ?? '<presentation/>');
  const rels = relationships(parts, 'ppt/presentation.xml', parseRels);
  const slides: { title: string; paragraphs: string[]; media: string | null }[] = [];
  for (const id of descendants(first(presentation, 'sldIdLst'), 'sldId').slice(0, MAX_SLIDES)) {
    const path = rels.get(relId(id) ?? '')?.target;
    const xml = path ? parts.get(path) : undefined;
    if (!path || !xml) continue;
    const doc = parseXml(xml);
    let title = '';
    const body: string[] = [];
    for (const sp of descendants(doc, 'sp')) {
      const type = attr(first(sp, 'ph'), 'type');
      if (type && SKIPPED.has(type)) continue;
      if (type === 'title' || type === 'ctrTitle') title = paragraphs(sp).join(' ');
      else body.push(...paragraphs(first(sp, 'txBody')));
    }
    const slideRels = relationships(parts, path, parseRels);
    const media =
      descendants(doc, 'pic')
        .map((pic) => slideRels.get(attr(first(pic, 'blip'), 'embed') ?? '')?.target)
        .find(
          (target) => !!target && PICTURE_EXT.has(target.split('.').pop()?.toLowerCase() ?? ''),
        ) ?? null;
    slides.push({ title, paragraphs: body, media });
  }
  // The pictures, only those used: a presentation's media folder may hold far more.
  const wanted = new Set(slides.flatMap((s) => (s.media ? [s.media] : [])));
  const files = wanted.size > 0 ? unzipSync(bytes, { filter: (f) => wanted.has(f.name) }) : {};
  return slides.map((s) => {
    const raw = s.media ? files[s.media] : undefined;
    return {
      title: s.title,
      paragraphs: s.paragraphs,
      picture:
        raw && s.media ? { bytes: raw, ext: s.media.split('.').pop()?.toLowerCase() ?? '' } : null,
    };
  });
}
