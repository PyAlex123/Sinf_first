/**
 * Scopes the author's lesson stylesheet under one root class, so it can be loaded globally in the platform UI
 * without touching anything outside the lesson player. `body`/`html`/`:root` become the root itself,
 * `#stage` becomes `.stage`, and every other selector is prefixed with the root (ADR-005 / S1.5).
 */

const PASSTHROUGH_AT_RULES =
  /^@(keyframes|-webkit-keyframes|font-face|page|counter-style|property)\b/;
const NESTING_AT_RULES = /^@(media|supports|container|layer)\b/;

export function scopeCss(css: string, root: string): string {
  const out: string[] = [];
  const input = stripComments(css);
  let i = 0;
  while (i < input.length) {
    const open = input.indexOf('{', i);
    if (open === -1) break;
    const selector = input.slice(i, open).trim();
    const close = matchingBrace(input, open);
    const body = input.slice(open + 1, close);
    i = close + 1;
    if (selector === '') continue;
    if (PASSTHROUGH_AT_RULES.test(selector)) {
      out.push(`${selector}{${body}}`);
    } else if (NESTING_AT_RULES.test(selector)) {
      out.push(`${selector}{${scopeCss(body, root)}}`);
    } else if (selector.startsWith('@')) {
      out.push(`${selector}{${body}}`);
    } else {
      out.push(`${scopeSelectorList(selector, root)}{${body.trim()}}`);
    }
  }
  return out.join('\n') + '\n';
}

export function scopeSelectorList(list: string, root: string): string {
  const scoped = splitSelectors(list).map((s) => scopeSelector(s.trim(), root));
  return [...new Set(scoped)].join(',');
}

function scopeSelector(selector: string, root: string): string {
  if (selector === '' || selector === ':root' || selector === 'html' || selector === 'body') {
    return root;
  }
  // `body.home .nav` → `.lesson-root.home .nav`; `html body` → root
  const bodyPrefixed = /^(?:html\s+)?body(?=[.:[\s>+~]|$)/.exec(selector);
  if (bodyPrefixed) {
    return root + selector.slice(bodyPrefixed[0].length);
  }
  if (selector.startsWith('html')) {
    return root + selector.slice(4);
  }
  const withStage = selector.replace(/#stage\b/g, '.stage');
  return `${root} ${withStage}`;
}

/** Splits a selector list on top-level commas (commas inside `:is(a,b)` or attribute selectors stay). */
function splitSelectors(list: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') result.push(current);
  return result;
}

function matchingBrace(input: string, open: number): number {
  let depth = 0;
  for (let i = open; i < input.length; i++) {
    const ch = input[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced braces in CSS at ${open}`);
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
