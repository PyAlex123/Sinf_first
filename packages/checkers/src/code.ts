/**
 * Reading program text without running it (stage 6, B5): comments go, every string literal becomes
 * a numbered placeholder `"N"` (its text kept aside), so the checks below look at code only and a
 * word inside a string never counts as a loop.
 */

export interface StrippedCode {
  /** The code with comments removed and strings as `"0"`, `"1"`… — line breaks kept. */
  code: string;
  /** The text of each string literal, by placeholder number. */
  strings: string[];
  /** A string or a comment that never closes: the program is broken. */
  unterminated: { line: number; what: 'string' | 'comment' } | null;
}

const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length;

/** C and C++ (an Arduino sketch): `//` and `/* *\/` comments, "strings" and 'c'haracters. */
export function stripC(source: string): StrippedCode {
  const strings: string[] = [];
  let code = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0)
        return { code, strings, unterminated: { line: lineAt(source, i), what: 'comment' } };
      // Keep the line breaks, so line numbers still match.
      code += source.slice(i, end + 2).replace(/[^\n]/g, '');
      i = end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== c && source[j] !== '\n') {
        if (source[j] === '\\') {
          text += source[j + 1] ?? '';
          j += 2;
        } else {
          text += source[j];
          j += 1;
        }
      }
      if (source[j] !== c) {
        return { code, strings, unterminated: { line: lineAt(source, i), what: 'string' } };
      }
      code += `"${strings.length}"`;
      strings.push(text);
      i = j + 1;
    } else {
      code += c;
      i += 1;
    }
  }
  return { code, strings, unterminated: null };
}

/** Python: `#` comments; '…', "…", '''…''' and """…""" with r/b/f/u prefixes. */
export function stripPython(source: string): StrippedCode {
  const strings: string[] = [];
  let code = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? '';
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    // A prefix belongs to the string only when it is not the end of a longer name.
    const prefix = /^[rRbBfFuU]{1,2}(?=['"])/.exec(source.slice(i, i + 3))?.[0] ?? '';
    const startsName = prefix !== '' && i > 0 && /[A-Za-z0-9_]/.test(source[i - 1] ?? '');
    const q = source[i + (startsName ? 0 : prefix.length)];
    if ((q === '"' || q === "'") && !startsName) {
      const raw = /r/i.test(prefix);
      const start = i;
      i += prefix.length;
      const triple = source.startsWith(q.repeat(3), i);
      const close = triple ? q.repeat(3) : q;
      i += close.length;
      let text = '';
      let closed = false;
      while (i < source.length) {
        if (source.startsWith(close, i)) {
          i += close.length;
          closed = true;
          break;
        }
        const ch = source[i] ?? '';
        if (ch === '\n' && !triple) break;
        if (ch === '\\' && !raw) {
          text += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        text += ch;
        i += 1;
      }
      if (!closed) {
        return { code, strings, unterminated: { line: lineAt(source, start), what: 'string' } };
      }
      code += `"${strings.length}"`;
      strings.push(text);
      continue;
    }
    code += c;
    i += 1;
  }
  return { code, strings, unterminated: null };
}

export const unclosed = (u: NonNullable<StrippedCode['unterminated']>): string =>
  `строка ${u.line}: ${u.what === 'string' ? 'строка в кавычках не закрыта' : 'комментарий не закрыт'}`;

/** Brackets that close in the right order; the first problem, by line. */
export function bracketProblem(code: string): string | null {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: { ch: string; line: number }[] = [];
  let line = 1;
  for (const ch of code) {
    if (ch === '\n') line += 1;
    else if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line });
    else if (ch in pairs) {
      const open = stack.pop();
      if (!open || open.ch !== pairs[ch]) return `строка ${line}: лишняя «${ch}»`;
    }
  }
  const open = stack.pop();
  return open ? `строка ${open.line}: «${open.ch}» не закрыта` : null;
}

/** The text between a call's brackets, split at its top-level commas. */
export function callArguments(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i] ?? '';
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  return args;
}

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `name(` or `Serial.begin(` — a call, also with spaces around the dot. */
export function callPattern(name: string): RegExp {
  const parts = name.split('.').map(escapeRe);
  return new RegExp(`(?<![\\w.])${parts.join('\\s*\\.\\s*')}\\s*\\(`, 'g');
}
