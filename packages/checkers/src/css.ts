/**
 * A tiny CSS reader (ADR-016): rules as selector → declarations, enough to answer "is `color` set
 * on `h1`?". At-rules with blocks (@media, @supports) are read inside; others are skipped.
 */
export interface CssRule {
  selector: string;
  declarations: Map<string, string>;
}

export function parseCss(source: string): CssRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let i = 0;
  const readBlock = (end: number): void => {
    while (i < end) {
      const open = css.indexOf('{', i);
      if (open < 0 || open >= end) return;
      const head = css.slice(i, open).trim();
      // Find the matching brace.
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      if (head.startsWith('@')) {
        const at = head.split(/\s/)[0];
        if (at === '@media' || at === '@supports' || at === '@layer') {
          const saved = i;
          i = open + 1;
          readBlock(j - 1);
          i = saved;
        }
      } else if (head) {
        const declarations = new Map<string, string>();
        for (const decl of css.slice(open + 1, j - 1).split(';')) {
          const colon = decl.indexOf(':');
          if (colon <= 0) continue;
          declarations.set(
            decl.slice(0, colon).trim().toLowerCase(),
            decl
              .slice(colon + 1)
              .replace(/!important/i, '')
              .trim(),
          );
        }
        rules.push({ selector: head.replace(/\s+/g, ' '), declarations });
      }
      i = j;
    }
  };
  readBlock(css.length);
  return rules;
}

/** `style="color: red; font-size: 14px"` as a rule of its own element. */
export function parseInline(selector: string, style: string): CssRule {
  return parseCss(`${selector}{${style}}`)[0] ?? { selector, declarations: new Map() };
}
