import { parseDocument } from 'htmlparser2';
import { isTag, isText, type ChildNode, type Element } from 'domhandler';

/**
 * A small XML toolkit over htmlparser2 (ADR-016), shared by the Office checkers.
 *
 * Office files are XML with namespace prefixes, and the prefixes are not fixed: Word writes `w:`,
 * another program may write `ns0:`. Elements and attributes are therefore matched by their local
 * name — the part after the colon — which is unambiguous inside one Office part.
 */

export type { Element };

export function parseXml(xml: string): Element[] {
  return parseDocument(xml, { xmlMode: true }).children.filter(isTag);
}

export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
}

/**
 * The relationship id of an element: `r:id`. Not just any "id" — a slide entry has both its own
 * number (`id`) and the relationship (`r:id`).
 */
export function relId(el: Element | undefined): string | undefined {
  if (!el) return undefined;
  for (const [key, value] of Object.entries(el.attribs)) {
    if (key.includes(':') && localName(key) === 'id') return value;
  }
  return undefined;
}

/** The element's attribute by local name: `w:val` and `val` alike. */
export function attr(el: Element | undefined, name: string): string | undefined {
  if (!el) return undefined;
  for (const [key, value] of Object.entries(el.attribs)) {
    if (localName(key) === name) return value;
  }
  return undefined;
}

export function children(el: Element | undefined, name?: string): Element[] {
  if (!el) return [];
  return el.children.filter(
    (c): c is Element => isTag(c) && (name === undefined || localName(c.name) === name),
  );
}

export function child(el: Element | undefined, name: string): Element | undefined {
  return children(el, name)[0];
}

/** Every descendant with this local name, in document order. */
export function descendants(root: Element | Element[] | undefined, name: string): Element[] {
  const out: Element[] = [];
  const walk = (nodes: ChildNode[]): void => {
    for (const node of nodes) {
      if (!isTag(node)) continue;
      if (localName(node.name) === name) out.push(node);
      walk(node.children);
    }
  };
  if (!root) return out;
  walk(Array.isArray(root) ? root : [root]);
  return out;
}

export function first(root: Element | Element[] | undefined, name: string): Element | undefined {
  return descendants(root, name)[0];
}

/** All text inside, as is. */
export function textContent(el: Element | undefined): string {
  if (!el) return '';
  let out = '';
  const walk = (nodes: ChildNode[]): void => {
    for (const node of nodes) {
      if (isText(node)) out += node.data;
      else if (isTag(node)) walk(node.children);
    }
  };
  walk(el.children);
  return decodeEntities(out);
}

/** htmlparser2 keeps entities in XML mode; Office writes only these five and numeric ones. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    const lower = e.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });
}

/** "on", "1", "true" or no value at all mean yes; "0", "false", "off" mean no. */
export function onOff(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, 'val');
  if (v === undefined) return true;
  return !['0', 'false', 'off', 'none'].includes(v.toLowerCase());
}

/** Text for comparing: one kind of space, no case, "ё" as "е". */
export function fold(s: string, caseSensitive = false): string {
  const t = s.replace(/[\s\u00a0]+/g, ' ').trim();
  return caseSensitive ? t : t.toLocaleLowerCase('ru').replace(/ё/g, 'е');
}
