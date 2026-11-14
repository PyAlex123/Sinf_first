/**
 * Student codes (STAGE1.md §5, architecture §9): for grades 1–2 an ordered pair of two different pictures out of
 * the six pictures of the class; for grade 3+ four digits. Codes are unique inside a class.
 */

export type Rng = () => number;

/** Separates the two picture keys of a code: `sun+ball`. */
export const CODE_SEPARATOR = '+';

/**
 * The six pictures a class gets by default for picture codes. Simple, far apart in meaning and present
 * in every course's `pics.json` (the seed test checks that). A school will be able to pick its own later.
 */
export const DEFAULT_CODE_PICS = ['sun', 'ball', 'tree', 'apple', 'star', 'house'] as const;

/** All ordered pairs of distinct pictures, joined with the separator. */
export function allPictureCodes(pics: readonly string[]): string[] {
  const codes: string[] = [];
  for (const a of pics) for (const b of pics) if (a !== b) codes.push(`${a}${CODE_SEPARATOR}${b}`);
  return codes;
}

/** A random picture code that no other student of the class uses. */
export function randomPictureCode(
  pics: readonly string[],
  taken: ReadonlySet<string>,
  rng: Rng = Math.random,
): string {
  const free = allPictureCodes(pics).filter((c) => !taken.has(c));
  if (free.length === 0) {
    throw new Error('No free picture codes left in this class');
  }
  return free[Math.floor(rng() * free.length)] as string;
}

export function randomDigitCode(taken: ReadonlySet<string>, rng: Rng = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code = String(Math.floor(rng() * 10000)).padStart(4, '0');
    if (!taken.has(code)) return code;
  }
  throw new Error('No free digit codes');
}

/** Public code as parts for the API: picture keys, or single digits. */
export function splitCode(kind: 'pics' | 'digits', code: string): string[] {
  return kind === 'pics' ? code.split(CODE_SEPARATOR) : [...code];
}
