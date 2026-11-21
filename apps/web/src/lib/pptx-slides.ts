import { readSlides } from '@sinf/checkers';
import { slidePicture, type SlidePicture } from './images.js';

/**
 * Slides from a PowerPoint file (stage 6, B4; ADR-019, addendum B4). Unlike a PDF, whose pages
 * become pictures, a `.pptx` gives the lesson builder ordinary slides it can edit: the title, the
 * text or the bullet points and the first picture of every slide, in the presentation's order. The
 * look of PowerPoint (layouts, fonts, colours) is not copied — a teacher who needs it exact saves
 * the presentation as PDF instead. Loaded only here, as its own chunk.
 */

export const MAX_PPTX_BYTES = 40 * 1024 * 1024;
/** The limits of a slide of the lesson builder (`SlideBlockSchema`). */
const TITLE = 120;
const TEXT = 1500;
const BULLET = 200;
const BULLETS = 12;

export class PptxProblem extends Error {
  constructor(readonly code: 'too_large' | 'unreadable' | 'empty') {
    super(code);
  }
}

export interface ImportedSlide {
  title: string;
  text: string;
  bullets: string[];
  picture: SlidePicture | null;
}

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** One paragraph is the slide's text; several are its points, and what does not fit is text. */
export function arrangeText(paragraphs: string[]): { text: string; bullets: string[] } {
  if (paragraphs.length <= 1) return { text: clip(paragraphs[0] ?? '', TEXT), bullets: [] };
  return {
    bullets: paragraphs.slice(0, BULLETS).map((p) => clip(p, BULLET)),
    text: clip(paragraphs.slice(BULLETS).join('\n'), TEXT),
  };
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

async function picture(bytes: Uint8Array, ext: string): Promise<SlidePicture | null> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }),
    );
    try {
      return await slidePicture(bitmap);
    } finally {
      bitmap.close();
    }
  } catch {
    return null; // a picture the browser cannot draw: the slide keeps its text
  }
}

export async function pptxToSlides(
  file: Blob,
  onSlide: (done: number, total: number) => void,
): Promise<ImportedSlide[]> {
  if (file.size > MAX_PPTX_BYTES) throw new PptxProblem('too_large');
  let read;
  try {
    read = readSlides(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new PptxProblem('unreadable');
  }
  if (read.length === 0) throw new PptxProblem('empty');
  const slides: ImportedSlide[] = [];
  for (const [i, slide] of read.entries()) {
    slides.push({
      title: clip(slide.title, TITLE),
      ...arrangeText(slide.paragraphs),
      picture: slide.picture ? await picture(slide.picture.bytes, slide.picture.ext) : null,
    });
    onSlide(i + 1, read.length);
  }
  return slides;
}
