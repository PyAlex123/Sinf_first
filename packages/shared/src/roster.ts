/**
 * Reading a class roster the teacher pasted from Excel or Word (STAGE2 S2.2). Pure, so the web can show
 * what was understood before sending and the server can check the same text the same way.
 *
 * Only the surname and the first name are kept: a patronymic, a class number or anything else in the
 * pasted row is dropped, because we store the minimum about a child (CLAUDE.md §3.4).
 */

/** A real class never grows past this (CLAUDE.md §2); the limit also guards a careless paste. */
export const MAX_STUDENTS_PER_CLASS = 40;

export interface RosterName {
  lastName: string;
  firstName: string;
}

export type RosterProblemReason =
  /** Only one word in the row: a surname without a first name, or the other way round. */
  | 'incomplete'
  /** The same surname and first name appeared earlier in this paste. */
  | 'duplicate'
  /** Nothing that looks like a name (digits, punctuation, a stray cell). */
  | 'unreadable';

export interface RosterProblem {
  /** Line number in the pasted text, counted from 1, so the teacher can find it. */
  line: number;
  text: string;
  reason: RosterProblemReason;
}

export interface RosterParseResult {
  students: RosterName[];
  problems: RosterProblem[];
}

/** Header rows Excel exports carry along; compared in lower case without punctuation. */
const HEADERS = new Set([
  'фамилия',
  'имя',
  'фио',
  'ф и о',
  'фамилия имя',
  'фамилия имя отчество',
  'ученик',
  'ученики',
  'familiya',
  'ism',
  'fio',
  'oquvchi',
  "o'quvchi",
  'name',
  'surname',
]);

/** Leading row number: "1.", "1)", "1 -", "1" followed by a separator. */
const LEADING_NUMBER = /^\s*\d{1,3}\s*[.)\-–—]?\s+/;

/** The "№" column Excel exports put in front of everything, header row included. */
const LEADING_NUMBER_SIGN = /^\s*(?:№|#|No\.?|N)\s*[.)\-–—]?\s*/i;

/** A word that can be part of a name: letters (any script), hyphen and apostrophe inside. */
const NAME_WORD = /^\p{L}[\p{L}\-'’ʻ`]*$/u;

function splitCells(line: string): string[] {
  // Excel and Word give tabs or semicolons between columns; a plain list gives two or more spaces.
  const cells = line.includes('\t')
    ? line.split('\t')
    : /[;,]/.test(line)
      ? line.split(/[;,]/)
      : line.split(/\s{2,}/);
  return cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0);
}

function isHeader(line: string): boolean {
  const flat = line
    .replace(LEADING_NUMBER_SIGN, '')
    .toLowerCase()
    .replace(/[\t;,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return HEADERS.has(flat);
}

function words(cells: string[]): string[] {
  return cells
    .flatMap((cell) => cell.split(/\s+/))
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

/**
 * Reads the pasted text. Rows keep their order; the caller decides what to do with the problems —
 * nothing is silently dropped or merged.
 */
export function parseRoster(text: string): RosterParseResult {
  const students: RosterName[] = [];
  const problems: RosterProblem[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || isHeader(trimmed)) {
      return;
    }
    const withoutNumber = trimmed.replace(LEADING_NUMBER_SIGN, '').replace(LEADING_NUMBER, '');
    const parts = words(splitCells(withoutNumber)).filter((word) => NAME_WORD.test(word));
    if (parts.length === 0) {
      problems.push({ line, text: trimmed, reason: 'unreadable' });
      return;
    }
    if (parts.length === 1) {
      problems.push({ line, text: trimmed, reason: 'incomplete' });
      return;
    }
    // "Фамилия Имя [Отчество]": the third word and anything after it are dropped.
    const [lastName, firstName] = parts as [string, string, ...string[]];
    const key = `${lastName.toLowerCase()} ${firstName.toLowerCase()}`;
    if (seen.has(key)) {
      problems.push({ line, text: trimmed, reason: 'duplicate' });
      return;
    }
    seen.add(key);
    students.push({ lastName, firstName });
  });

  return { students, problems };
}
