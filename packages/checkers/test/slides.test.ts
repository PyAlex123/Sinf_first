import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSlides } from '../src/index.js';
import { loadPptx } from '../src/pptx.js';

/** B4 (stage 6): the slides of a PowerPoint file for the lesson builder. */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'pptx', name)));

describe('slides of a presentation', () => {
  it('come in the presentation’s order, with titles and text', () => {
    for (const name of ['good.pptx', 'reordered.pptx', 'bad.pptx']) {
      const bytes = fixture(name);
      const slides = readSlides(bytes);
      // The same order and titles as the checker sees.
      expect(
        slides.map((s) => s.title),
        name,
      ).toEqual(loadPptx(bytes).slides.map((s) => s.title));
    }
    const good = readSlides(fixture('good.pptx'));
    expect(good.some((s) => s.paragraphs.length > 0)).toBe(true);
    expect(good.every((s) => s.paragraphs.every((p) => p.trim() === p && p !== ''))).toBe(true);
  });

  it('bring a picture where the slide has one', () => {
    const bytes = fixture('good.pptx');
    const pictures = loadPptx(bytes).slides.map((s) => s.pictures);
    const read = readSlides(bytes);
    read.forEach((slide, i) => {
      if ((pictures[i] ?? 0) === 0) expect(slide.picture).toBeNull();
    });
    const photo = read.find((s) => s.title === 'Фотография');
    expect(photo?.picture?.ext).toBe('png');
    // A real PNG, as it lies in the file.
    expect([...(photo?.picture?.bytes.slice(1, 4) ?? [])]).toEqual([0x50, 0x4e, 0x47]);
  });

  it('take a teacher’s presentation apart: points, text boxes, pictures', () => {
    const slides = readSlides(fixture('lesson.pptx'));
    expect(slides.map((s) => s.title)).toEqual([
      'Компьютер и его части',
      'Устройства ввода',
      'Монитор',
      '',
    ]);
    expect(slides.map((s) => s.paragraphs)).toEqual([
      ['Урок 1'],
      ['Клавиатура', 'Мышь', 'Микрофон', 'Сканер'],
      ['Показывает изображение'],
      [],
    ]);
    expect(slides.map((s) => s.picture?.ext ?? null)).toEqual([null, null, 'png', 'png']);
    // Each slide its own picture, not the first one of the file twice.
    expect(slides[2]?.picture?.bytes).not.toEqual(slides[3]?.picture?.bytes);
  });

  it('refuses what is not a presentation, as the checkers do', () => {
    expect(() => readSlides(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
