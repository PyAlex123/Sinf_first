import {
  allElements,
  createSvgElement,
  getHref,
  removeNode,
  replaceNode,
  setAttr,
  type Element,
  type ParentNode,
} from './dom.js';
import { decodeDataImage, type MediaStore } from './media.js';

/**
 * The author's files embed screenshots as base64 `<image id="g03" href="data:…">` inside a hidden
 * `<svg><defs>` and draw them with `<use href="#g03"/>`. A page that has all of them loads every picture of the
 * quarter at once. The import replaces each `<use>` with an `<image>` that points to a WebP file, so a screen
 * loads only its own pictures, and only when it is shown.
 */

/** A base64 image definition: its SVG attributes (without id and href) and decoded bytes. */
export interface ImageDef {
  attrs: { name: string; value: string }[];
  bytes: Buffer;
}

/** Collects `<image>` definitions with a data URL from all `<defs>` under `root` and removes them from the tree. */
export function takeImageDefs(root: ParentNode): Map<string, ImageDef> {
  const defs = new Map<string, ImageDef>();
  for (const el of allElements(root)) {
    if (el.tagName !== 'image' || !isInsideDefs(el)) {
      continue;
    }
    const id = el.attrs.find((a) => a.name === 'id')?.value;
    const bytes = decodeDataImage(getHref(el) ?? '');
    if (!id || !bytes) {
      continue;
    }
    defs.set(id, {
      attrs: el.attrs
        .filter((a) => a.name !== 'id' && a.name !== 'href')
        .map(({ name, value }) => ({ name, value })),
      bytes,
    });
    removeNode(el);
  }
  return defs;
}

function isInsideDefs(el: Element): boolean {
  for (let node = el.parentNode; node; node = 'parentNode' in node ? node.parentNode : null) {
    if ('tagName' in node && node.tagName === 'defs') {
      return true;
    }
  }
  return false;
}

/** All image sources the tree needs: referenced definitions and inline data URLs. */
export function collectImageSources(root: ParentNode, defs: Map<string, ImageDef>): Buffer[] {
  const sources: Buffer[] = [];
  for (const el of allElements(root)) {
    const href = getHref(el) ?? el.attrs.find((a) => a.name === 'src')?.value ?? '';
    const def = el.tagName === 'use' && href.startsWith('#') ? defs.get(href.slice(1)) : undefined;
    const inline = decodeDataImage(href);
    if (def) sources.push(def.bytes);
    if (inline) sources.push(inline);
  }
  return sources;
}

/**
 * Replaces `<use href="#id">` of image definitions with `<image href="/content/…/media/<hash>.webp">` and converts
 * inline data URLs (`href`/`src`) to media files. Returns the media URLs used by the tree, in document order.
 */
export function linkImages(
  root: ParentNode,
  defs: Map<string, ImageDef>,
  media: MediaStore,
): string[] {
  const urls: string[] = [];
  for (const el of allElements(root)) {
    const href = getHref(el);
    if (el.tagName === 'use' && href?.startsWith('#')) {
      const def = defs.get(href.slice(1));
      if (!def) {
        continue; // a <use> of a non-image definition (symbol, gradient…) stays as is
      }
      const url = media.url(def.bytes);
      replaceNode(el, createSvgElement('image', mergeUseAttrs(def.attrs, el, url)));
      urls.push(url);
      continue;
    }
    for (const attr of el.attrs) {
      if (attr.name !== 'href' && attr.name !== 'src') {
        continue;
      }
      const bytes = decodeDataImage(attr.value);
      if (bytes) {
        const url = media.url(bytes);
        delete attr.prefix;
        delete attr.namespace;
        attr.value = url;
        urls.push(url);
      }
    }
  }
  return urls;
}

/** Attributes of the replacement `<image>`: the definition's, shifted by the `<use>` x/y, plus its other attributes. */
function mergeUseAttrs(
  defAttrs: { name: string; value: string }[],
  use: Element,
  url: string,
): { name: string; value: string }[] {
  const image = createSvgElement(
    'image',
    defAttrs.map((a) => ({ ...a })),
  );
  for (const { name, value } of use.attrs) {
    if (name === 'href') continue;
    if (name === 'x' || name === 'y') {
      const base = Number(image.attrs.find((a) => a.name === name)?.value ?? 0);
      setAttr(image, name, String(base + Number(value)));
    } else {
      setAttr(image, name, value);
    }
  }
  setAttr(image, 'href', url);
  return image.attrs;
}
