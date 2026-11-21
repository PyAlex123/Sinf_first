import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arrangeText, pptxToSlides, PptxProblem } from '../src/lib/pptx-slides.js';

/** B4 (stage 6): a PowerPoint file becomes slides of the lesson builder. */

const fixture = (name: string) =>
  new Blob([
    readFileSync(join(import.meta.dirname, '../../../packages/checkers/fixtures/pptx', name)),
  ]);

describe('the text of an imported slide', () => {
  it('is one paragraph as text, several as points', () => {
    expect(arrangeText([])).toEqual({ text: '', bullets: [] });
    expect(arrangeText(['Урок 1'])).toEqual({ text: 'Урок 1', bullets: [] });
    expect(arrangeText(['Мышь', 'Клавиатура'])).toEqual({
      text: '',
      bullets: ['Мышь', 'Клавиатура'],
    });
  });

  it('fits the builder’s limits instead of being refused', () => {
    const many = Array.from({ length: 15 }, (_, i) => `пункт ${i + 1}`);
    const arranged = arrangeText(many);
    expect(arranged.bullets).toHaveLength(12);
    expect(arranged.text).toBe('пункт 13\nпункт 14\nпункт 15');
    const long = arrangeText(['я'.repeat(2000)]);
    expect(long.text).toHaveLength(1500);
    expect(long.text.endsWith('…')).toBe(true);
    expect(arrangeText(['а'.repeat(300), 'б']).bullets[0]).toHaveLength(200);
  });
});

describe('slides from a presentation', () => {
  it('come in order with titles, points and text', async () => {
    const seen: string[] = [];
    const slides = await pptxToSlides(fixture('lesson.pptx'), (done, total) =>
      seen.push(`${done}/${total}`),
    );
    expect(seen).toEqual(['1/4', '2/4', '3/4', '4/4']);
    expect(slides.map(({ title, text, bullets }) => ({ title, text, bullets }))).toEqual([
      { title: 'Компьютер и его части', text: 'Урок 1', bullets: [] },
      {
        title: 'Устройства ввода',
        text: '',
        bullets: ['Клавиатура', 'Мышь', 'Микрофон', 'Сканер'],
      },
      { title: 'Монитор', text: 'Показывает изображение', bullets: [] },
      { title: '', text: '', bullets: [] },
    ]);
  });

  it('refuses what it cannot use, with a reason', async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: unknown) => (e instanceof PptxProblem ? e.code : 'other'),
      );
    expect(await code(pptxToSlides(new Blob(['not a zip']), () => undefined))).toBe('unreadable');
    const huge = { size: 41 * 1024 * 1024 } as Blob;
    expect(await code(pptxToSlides(huge, () => undefined))).toBe('too_large');
  });
});
