import type { PracticeCheck } from '@sinf/shared';
import {
  bracketProblem,
  callArguments,
  callPattern,
  escapeRe,
  stripPython,
  unclosed,
  type StrippedCode,
} from './code.js';
import { verdict, type Verdict } from './verdict.js';
import { fold } from './xml.js';

/**
 * Python programs (`.py`; stage 6, B5; ADR-016, addendum B5): read, not run. Running a child's
 * program needs a sandbox and a time limit that a classroom computer and the browser do not give
 * yet; what the program has — a loop, a function, what it prints — and whether Python would even
 * accept it (brackets, quotes, colons, indentation) is checked from the text.
 */

type PyCheck = Extract<PracticeCheck, { type: `py.${string}` }>;

export type PyModel = StrippedCode;

export const loadPy = (text: string): PyModel => stripPython(text.replace(/\r\n?/g, '\n'));

const CONSTRUCTS: Record<Extract<PyCheck, { type: 'py.uses' }>['construct'], RegExp> = {
  for: /\bfor\b[^\n]*?\bin\b/,
  while: /^[ \t]*while\b/m,
  if: /^[ \t]*if\b/m,
  def: /^[ \t]*(?:async[ \t]+)?def[ \t]+\w+/m,
  return: /^[ \t]*return\b/m,
  import: /^[ \t]*(?:import|from)[ \t]+\w/m,
  input: /(?<![\w.])input\s*\(/,
  print: /(?<![\w.])print\s*\(/,
  list: /(?:^|[=(,:[]|\breturn|\bin)[ \t]*\[|(?<![\w.])list\s*\(|\.append\s*\(/m,
  try: /^[ \t]*try[ \t]*:/m,
};

/** Statements that must end with a colon and open a block. */
const HEADER = /^(?:if|elif|else|for|while|def|class|try|except|finally|with|async)\b/;

/** Physical lines joined into logical ones: inside brackets, or after a backslash. */
function logicalLines(code: string): { text: string; indent: string; line: number }[] {
  const out: { text: string; indent: string; line: number }[] = [];
  let depth = 0;
  let current: { text: string; indent: string; line: number } | null = null;
  code.split('\n').forEach((raw, index) => {
    if (!current) {
      if (!raw.trim()) return;
      current = { text: '', indent: /^[ \t]*/.exec(raw)?.[0] ?? '', line: index + 1 };
    }
    let line = raw;
    const continued = /\\[ \t]*$/.test(line);
    if (continued) line = line.replace(/\\[ \t]*$/, '');
    current.text += (current.text ? ' ' : '') + line.trim();
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    }
    if (depth === 0 && !continued) {
      out.push(current);
      current = null;
    }
  });
  if (current) out.push(current);
  return out;
}

/** What Python would refuse to start: the first problem, or null. */
export function syntaxProblem(model: PyModel): string | null {
  if (model.unterminated) return unclosed(model.unterminated);
  const brackets = bracketProblem(model.code);
  if (brackets) return brackets;
  const lines = logicalLines(model.code);
  const indents = lines.map((l) => l.indent).join('');
  if (indents.includes('\t') && indents.includes(' ')) {
    return 'отступы и табуляцией, и пробелами — выберите что-то одно';
  }
  const stack = [''];
  let opened: number | null = null;
  for (const { text, indent, line } of lines) {
    const top = stack.at(-1) ?? '';
    if (opened !== null) {
      if (indent.length <= top.length)
        return `строка ${opened}: после двоеточия нет блока с отступом`;
      stack.push(indent);
      opened = null;
    } else if (indent.length > top.length) {
      return `строка ${line}: лишний отступ`;
    } else if (indent.length < top.length) {
      while (stack.length > 1 && (stack.at(-1) ?? '').length > indent.length) stack.pop();
      if ((stack.at(-1) ?? '') !== indent) return `строка ${line}: отступ не совпадает с блоком`;
    }
    if (HEADER.test(text) && !text.includes(':')) return `строка ${line}: нет двоеточия`;
    if (text.endsWith(':')) opened = line;
  }
  return opened !== null ? `строка ${opened}: после двоеточия нет блока с отступом` : null;
}

export function runPy(model: PyModel, check: PyCheck): Verdict {
  const { code, strings } = model;
  switch (check.type) {
    case 'py.function': {
      const names = [...code.matchAll(/^[ \t]*(?:async[ \t]+)?def[ \t]+(\w+)/gm)].map((m) => m[1]);
      return verdict(
        check.name ? names.includes(check.name) : names.length > 0,
        names.length ? `функции: ${names.join(', ')}` : 'функций нет',
      );
    }
    case 'py.variable': {
      const name = escapeRe(check.name);
      const assigned = new RegExp(
        `(?<![\\w.])${name}\\s*(?::[^=\\n]+)?(?:=(?!=)|[-+*/%]=|//=|\\*\\*=)|\\bfor\\s+(?:[\\w\\s,]*,\\s*)?${name}\\b[\\w\\s,]*\\bin\\b`,
      );
      return verdict(assigned.test(code), null);
    }
    case 'py.uses':
      return verdict(CONSTRUCTS[check.construct].test(code), null);
    case 'py.prints': {
      const printed: string[] = [];
      for (const m of code.matchAll(callPattern('print'))) {
        for (const arg of callArguments(code, m.index + m[0].length - 1)) {
          for (const s of arg.matchAll(/"(\d+)"/g)) printed.push(strings[Number(s[1])] ?? '');
        }
      }
      const wanted = fold(check.text, check.caseSensitive);
      return verdict(
        printed.some((p) => fold(p, check.caseSensitive).includes(wanted)),
        printed.length ? null : 'print с текстом нет',
      );
    }
    case 'py.syntax': {
      const problem = syntaxProblem(model);
      return verdict(!problem, problem);
    }
  }
}
