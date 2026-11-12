/**
 * Reads JSON literals assigned to variables in the author's inline scripts, without evaluating any code.
 * The author's files declare data as `const TITLE = "…", TEACHER = "…", APPS = [...], PICS = {...};`.
 */

/** Finds `name = <JSON value>` (after `const|let|var` or a comma) and returns the parsed value. */
export function extractJsonAssignment(source: string, name: string): unknown {
  const pattern = new RegExp(
    `(?:\\b(?:const|let|var)\\s+|,\\s*)${escapeRegExp(name)}\\s*=\\s*`,
    'g',
  );
  const match = pattern.exec(source);
  if (!match) {
    throw new Error(`Variable "${name}" not found`);
  }
  const start = match.index + match[0].length;
  const end = scanJsonValue(source, start);
  try {
    return JSON.parse(source.slice(start, end)) as unknown;
  } catch (error) {
    throw new Error(`Variable "${name}" is not a JSON literal: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/** Returns the index just after the JSON value (string, array or object) that starts at `start`. */
export function scanJsonValue(source: string, start: number): number {
  const first = source[start];
  if (first === '"') {
    return scanString(source, start);
  }
  if (first !== '[' && first !== '{') {
    throw new Error(`Expected a JSON string, array or object at ${start}`);
  }
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      i = scanString(source, i) - 1;
    } else if (ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  throw new Error(`Unterminated JSON value at ${start}`);
}

function scanString(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '"') {
      return i + 1;
    }
  }
  throw new Error(`Unterminated string at ${start}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
