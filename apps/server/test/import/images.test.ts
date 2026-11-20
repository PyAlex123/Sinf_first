import { parse, parseFragment, serialize } from 'parse5';
import { describe, expect, it } from 'vitest';
import { collectImageSources, linkImages, takeImageDefs } from '../../src/import/images.js';
import { decodeDataImage, MAX_IMAGE_BYTES, MediaStore, toWebp } from '../../src/import/media.js';
import { jpegDataUrl } from './helpers.js';

describe('images', () => {
  it('replaces <use> of base64 definitions with WebP files and drops the definitions', async () => {
    const red = await jpegDataUrl('#ff0000');
    const doc = parse(
      `<svg><defs><pattern id="p"></pattern><image id="a02" x="0" y="0" width="1190" height="725" preserveAspectRatio="none" href="${red}"/></defs></svg>`,
    );
    const defs = takeImageDefs(doc);
    expect([...defs.keys()]).toEqual(['a02']);
    expect(serialize(doc)).not.toContain('data:');
    expect(serialize(doc)).toContain('<pattern id="p">');

    const slide = parseFragment('<svg><use href="#a02" x="5" class="shot"/><use href="#p"/></svg>');
    const media = new MediaStore('course-1');
    await media.prepare(collectImageSources(slide, defs));
    const urls = linkImages(slide, defs, media);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^\/content\/course-1\/media\/[0-9a-f]{16}\.webp$/);
    const html = serialize(slide);
    expect(html).toContain(
      `<image x="5" y="0" width="1190" height="725" preserveAspectRatio="none" class="shot" href="${urls[0]}">`,
    );
    expect(html).toContain('<use href="#p">'); // non-image definitions stay
    expect(media.files()).toHaveLength(1);
  });

  it('stores the same picture once and gives it a content-hash name', async () => {
    const media = new MediaStore('c');
    const bytes = decodeDataImage(await jpegDataUrl('#123456'));
    if (!bytes) throw new Error('decode failed');
    await media.prepare([bytes, Buffer.from(bytes)]);
    expect(media.url(bytes)).toBe(media.url(Buffer.from(bytes)));
    expect(media.files()).toHaveLength(1);
  });

  it('keeps images within the width and size budget', async () => {
    const big = decodeDataImage(await jpegDataUrl('#336699', 2400, 1400));
    if (!big) throw new Error('decode failed');
    const webp = await toWebp(big);
    const { default: sharp } = await import('sharp');
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1190);
    expect(webp.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
  });

  it('decodes only image data URLs', () => {
    expect(decodeDataImage('data:text/html;base64,PHA+')).toBeUndefined();
    expect(decodeDataImage('#a01')).toBeUndefined();
  });
});
