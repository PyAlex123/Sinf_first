import { CONTENT_URL_PREFIX } from '@sinf/shared';
import {
  allElements,
  getAttr,
  isElement,
  removeAttrs,
  removeNode,
  type ParentNode,
} from './dom.js';

/**
 * Removes active content from the author's HTML: scripts, embedded frames, event handlers and URLs that leave
 * the platform. The lessons are trusted author content; this is defence in depth, not an untrusted-HTML filter.
 *
 * Allowed URLs: fragment links (`#id`) and platform content (`/content/…`). Images are converted to
 * `/content/…` URLs before sanitizing, so any remaining `data:` URL is dropped too.
 */

const REMOVED_ELEMENTS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'form',
  'portal',
]);
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'poster',
  'background',
  'ping',
]);

export interface SanitizeStats {
  removedElements: number;
  removedAttributes: number;
}

export function isAllowedUrl(value: string): boolean {
  const url = value.trim();
  return url.startsWith('#') || url.startsWith(`${CONTENT_URL_PREFIX}/`);
}

/** CSS is allowed unless it imports or fetches anything outside fragments and platform content. */
export function isSafeCss(css: string): boolean {
  if (/@import|expression\s*\(|javascript:|behavior\s*:/i.test(css)) {
    return false;
  }
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (!isAllowedUrl(match[2] ?? '')) {
      return false;
    }
  }
  return true;
}

export function sanitizeTree(root: ParentNode): SanitizeStats {
  const stats: SanitizeStats = { removedElements: 0, removedAttributes: 0 };
  for (const el of allElements(root)) {
    if (!el.parentNode) {
      continue; // already removed together with an ancestor
    }
    const tag = el.tagName.toLowerCase();
    if (REMOVED_ELEMENTS.has(tag) || isActiveMeta(tag, el) || isHrefAnimation(tag, el)) {
      removeNode(el);
      stats.removedElements++;
      continue;
    }
    if (tag === 'style') {
      const css = el.childNodes.map((n) => ('value' in n ? n.value : '')).join('');
      if (!isSafeCss(css)) {
        removeNode(el);
        stats.removedElements++;
      }
      continue;
    }
    stats.removedAttributes += removeAttrs(el, (name, value) => {
      const lower = name.toLowerCase();
      if (lower.startsWith('on')) {
        return true;
      }
      if (URL_ATTRIBUTES.has(lower)) {
        return !isAllowedUrl(value);
      }
      if (lower === 'style') {
        return !isSafeCss(value);
      }
      return false;
    });
  }
  return stats;
}

function isActiveMeta(tag: string, el: Parameters<typeof getAttr>[0]): boolean {
  return tag === 'meta' && getAttr(el, 'http-equiv') !== undefined;
}

/** SVG <set>/<animate> can rewrite href at runtime (e.g. to `javascript:`). */
function isHrefAnimation(tag: string, el: Parameters<typeof getAttr>[0]): boolean {
  return (
    (tag === 'set' || tag.startsWith('animate')) &&
    (getAttr(el, 'attributeName') ?? getAttr(el, 'attributename') ?? '')
      .toLowerCase()
      .endsWith('href')
  );
}

/** True if the tree still contains anything the sanitizer would remove (used by tests and import checks). */
export function hasActiveContent(root: ParentNode): boolean {
  return allElements(root).some(
    (el) =>
      isElement(el) &&
      (REMOVED_ELEMENTS.has(el.tagName.toLowerCase()) ||
        el.attrs.some((a) => a.name.toLowerCase().startsWith('on')) ||
        el.attrs.some((a) => URL_ATTRIBUTES.has(a.name.toLowerCase()) && !isAllowedUrl(a.value))),
  );
}
