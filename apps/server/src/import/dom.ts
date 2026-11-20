import { defaultTreeAdapter, html, type DefaultTreeAdapterTypes as T } from 'parse5';

/** Small helpers over the parse5 tree. */

export type Element = T.Element;
export type ParentNode = T.ParentNode;
export type ChildNode = T.ChildNode;

export const SVG_NS = html.NS.SVG;

export function isElement(node: T.Node): node is T.Element {
  return 'tagName' in node;
}

export function childrenOf(node: T.ParentNode): T.ChildNode[] {
  // <template> keeps its children in `content`.
  if (isElement(node) && node.tagName === 'template' && 'content' in node) {
    return node.content.childNodes;
  }
  return node.childNodes;
}

/** Depth-first list of all elements under `root` (a snapshot: safe to modify the tree while iterating). */
export function allElements(root: T.ParentNode): T.Element[] {
  const result: T.Element[] = [];
  const visit = (node: T.ParentNode): void => {
    for (const child of childrenOf(node)) {
      if (isElement(child)) {
        result.push(child);
        visit(child);
      }
    }
  };
  visit(root);
  return result;
}

export function getAttr(el: T.Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/** `href` or `xlink:href`. */
export function getHref(el: T.Element): string | undefined {
  return getAttr(el, 'href');
}

export function setAttr(el: T.Element, name: string, value: string): void {
  const attr = el.attrs.find((a) => a.name === name && a.prefix === undefined);
  if (attr) {
    attr.value = value;
  } else {
    el.attrs.push({ name, value });
  }
}

export function removeAttrs(
  el: T.Element,
  predicate: (name: string, value: string) => boolean,
): number {
  const before = el.attrs.length;
  el.attrs = el.attrs.filter((a) => !predicate(a.name, a.value));
  return before - el.attrs.length;
}

export function hasClass(el: T.Element, cls: string): boolean {
  return (getAttr(el, 'class') ?? '').split(/\s+/).includes(cls);
}

export function textContent(node: T.Node): string {
  if ('value' in node && node.nodeName === '#text') {
    return node.value;
  }
  if (!('childNodes' in node)) {
    return '';
  }
  return childrenOf(node).map(textContent).join('');
}

export function removeNode(node: T.ChildNode): void {
  defaultTreeAdapter.detachNode(node);
}

export function replaceNode(oldNode: T.ChildNode, newNode: T.ChildNode): void {
  const parent = oldNode.parentNode;
  if (!parent) {
    throw new Error('Cannot replace a detached node');
  }
  const siblings = childrenOf(parent);
  const index = siblings.indexOf(oldNode);
  siblings[index] = newNode;
  newNode.parentNode = parent;
  oldNode.parentNode = null;
}

export function createSvgElement(
  tagName: string,
  attrs: { name: string; value: string }[],
): T.Element {
  return defaultTreeAdapter.createElement(tagName, SVG_NS, attrs);
}

export function find(
  root: T.ParentNode,
  predicate: (el: T.Element) => boolean,
): T.Element | undefined {
  return allElements(root).find(predicate);
}

export function findAll(root: T.ParentNode, predicate: (el: T.Element) => boolean): T.Element[] {
  return allElements(root).filter(predicate);
}
