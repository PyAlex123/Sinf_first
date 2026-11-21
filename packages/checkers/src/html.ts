import { Parser } from 'htmlparser2';
import type { PracticeCheck } from '@sinf/shared';
import { parseCss, parseInline, type CssRule } from './css.js';
import { verdict, type Verdict } from './verdict.js';
import { fold } from './xml.js';

/**
 * Web pages (.html) and stylesheets (.css) a child writes in Notepad. htmlparser2 is used as a
 * tokenizer on purpose: it reports a tag it had to close itself, which is exactly the "you forgot
 * </p>" a school check is about; a spec HTML5 parser would silently mend it (ADR-016).
 */

type HtmlCheck = Extract<PracticeCheck, { type: `html.${string}` | `css.${string}` }>;

interface Tag {
  name: string;
  attrs: Record<string, string>;
}

export interface HtmlModel {
  tags: Tag[];
  doctype: boolean;
  title: string;
  text: string;
  /** Tags left open, that the parser had to close. */
  unclosed: string[];
  css: CssRule[];
  stylesheetLink: boolean;
  tables: { rows: number; cols: number }[];
  lists: number[];
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

export function loadHtml(source: string): HtmlModel {
  const tags: Tag[] = [];
  const unclosed: string[] = [];
  const styles: string[] = [];
  const inline: CssRule[] = [];
  const tables: { rows: number; cols: number }[] = [];
  const tableStack: { rows: number; cols: number; cells: number }[] = [];
  const lists: number[] = [];
  const listStack: number[] = [];
  let doctype = false;
  let title = '';
  let text = '';
  let inTitle = false;
  let inStyle = false;
  let inScript = false;

  const parser = new Parser(
    {
      onprocessinginstruction(name) {
        if (name.toLowerCase() === '!doctype') doctype = true;
      },
      onopentag(name, attrs) {
        tags.push({ name, attrs });
        if (name === 'title') inTitle = true;
        if (name === 'style') inStyle = true;
        if (name === 'script') inScript = true;
        if (attrs['style']) inline.push(parseInline(name, attrs['style']));
        if (name === 'table') tableStack.push({ rows: 0, cols: 0, cells: 0 });
        if (name === 'tr') {
          const t = tableStack.at(-1);
          if (t) {
            t.rows += 1;
            t.cells = 0;
          }
        }
        if (name === 'td' || name === 'th') {
          const t = tableStack.at(-1);
          if (t) {
            t.cells += 1;
            t.cols = Math.max(t.cols, t.cells);
          }
        }
        if (name === 'ul' || name === 'ol') listStack.push(0);
        if (name === 'li' && listStack.length)
          listStack[listStack.length - 1] = (listStack.at(-1) ?? 0) + 1;
      },
      ontext(data) {
        if (inTitle) title += data;
        if (inStyle) styles.push(data);
        else if (!inScript) text += data;
      },
      onclosetag(name, isImplied) {
        if (isImplied && !VOID.has(name)) unclosed.push(name);
        if (name === 'title') inTitle = false;
        if (name === 'style') inStyle = false;
        if (name === 'script') inScript = false;
        if (name === 'table') {
          const t = tableStack.pop();
          if (t) tables.push({ rows: t.rows, cols: t.cols });
        }
        if (name === 'ul' || name === 'ol') lists.push(listStack.pop() ?? 0);
      },
    },
    { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
  );
  parser.write(source);
  parser.end();

  return {
    tags,
    doctype,
    title: title.trim(),
    text,
    unclosed,
    css: [...styles.flatMap(parseCss), ...inline],
    stylesheetLink: tags.some(
      (t) =>
        t.name === 'link' &&
        (t.attrs['rel'] ?? '').toLowerCase().split(/\s+/).includes('stylesheet'),
    ),
    tables,
    lists,
  };
}

/** A stylesheet file: only its rules. */
export function loadCss(source: string): HtmlModel {
  return {
    tags: [],
    doctype: false,
    title: '',
    text: '',
    unclosed: [],
    css: parseCss(source),
    stylesheetLink: true,
    tables: [],
    lists: [],
  };
}

const sameValue = (a: string, b: string): boolean =>
  a.replace(/\s+/g, '').replace(/['"]/g, '').toLowerCase() ===
  b.replace(/\s+/g, '').replace(/['"]/g, '').toLowerCase();

export function runHtml(m: HtmlModel, check: HtmlCheck): Verdict {
  switch (check.type) {
    case 'html.tag': {
      const n = m.tags.filter((t) => t.name === check.tag).length;
      return verdict(n >= check.min, `<${check.tag}>: ${n}`);
    }
    case 'html.attr': {
      const ok = m.tags.some(
        (t) =>
          t.name === check.tag &&
          check.attr in t.attrs &&
          (check.value === undefined || sameValue(t.attrs[check.attr] ?? '', check.value)),
      );
      return verdict(ok, null);
    }
    case 'html.title':
      return verdict(
        !!m.title && (check.contains === undefined || fold(m.title).includes(fold(check.contains))),
        m.title ? `заголовок: «${m.title}»` : 'нет <title>',
      );
    case 'html.links': {
      const n = m.tags.filter((t) => t.name === 'a' && t.attrs['href']).length;
      return verdict(n >= check.min, `ссылок: ${n}`);
    }
    case 'html.images': {
      const imgs = m.tags.filter((t) => t.name === 'img' && t.attrs['src']);
      const withAlt = imgs.filter((t) => (t.attrs['alt'] ?? '').trim()).length;
      return verdict(
        imgs.length >= check.min && (!check.alt || withAlt === imgs.length),
        `картинок: ${imgs.length}, с подписью alt: ${withAlt}`,
      );
    }
    case 'html.table': {
      const ok = m.tables.some((t) => t.rows >= check.minRows && t.cols >= check.minCols);
      const best = m.tables.map((t) => `${t.rows}×${t.cols}`).join(', ') || 'нет';
      return verdict(ok, `таблицы: ${best}`);
    }
    case 'html.list':
      return verdict(
        Math.max(0, ...m.lists) >= check.minItems,
        `пунктов в списке: ${Math.max(0, ...m.lists)}`,
      );
    case 'html.wellFormed': {
      const problems = [
        ...(m.doctype ? [] : ['нет <!DOCTYPE html>']),
        ...[...new Set(m.unclosed)].map((t) => `не закрыт <${t}>`),
      ];
      return verdict(problems.length === 0, problems.join('; ') || null);
    }
    case 'html.text':
      return verdict(
        fold(m.text, check.caseSensitive).includes(fold(check.contains, check.caseSensitive)),
        null,
      );
    case 'css.property': {
      const ok = m.css.some(
        (rule) =>
          (check.selector === undefined ||
            rule.selector
              .split(',')
              .some((s) => s.trim().toLowerCase() === check.selector?.trim().toLowerCase())) &&
          rule.declarations.has(check.property) &&
          (check.value === undefined ||
            sameValue(rule.declarations.get(check.property) ?? '', check.value)),
      );
      return verdict(ok, null);
    }
    case 'css.linked':
      return verdict(m.stylesheetLink || m.css.length > 0, null);
  }
}
