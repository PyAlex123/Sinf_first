import type { PracticeCheck } from '@sinf/shared';
import { unknown, verdict, type Verdict } from './verdict.js';
import { fold } from './xml.js';

/** Plain text (.txt), and the text of any text file: these checks work on .html and .css too. */

type TxtCheck = Extract<PracticeCheck, { type: `txt.${string}` }>;

export function runTxt(text: string, check: TxtCheck): Verdict {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim());
  switch (check.type) {
    case 'txt.notEmpty':
      return verdict(text.trim().length > 0, null);
    case 'txt.contains':
      return verdict(
        fold(text, check.caseSensitive).includes(fold(check.text, check.caseSensitive)),
        null,
      );
    case 'txt.notContains':
      return verdict(
        !fold(text, check.caseSensitive).includes(fold(check.text, check.caseSensitive)),
        null,
      );
    case 'txt.lines':
      return verdict(lines.length >= check.min, `строк с текстом: ${lines.length}`);
    case 'txt.words': {
      const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
      return verdict(words >= check.min, `слов: ${words}`);
    }
    case 'txt.chars': {
      const chars = text.replace(/\s/g, '').length;
      return verdict(chars >= check.min, `знаков без пробелов: ${chars}`);
    }
    case 'txt.matches': {
      let re: RegExp;
      try {
        re = new RegExp(check.pattern, `${check.flags}u`);
      } catch {
        return unknown('образец в задании записан с ошибкой');
      }
      return verdict(re.test(text), null);
    }
    case 'txt.startsWith':
      return verdict(
        fold(text, check.caseSensitive).startsWith(fold(check.text, check.caseSensitive)),
        null,
      );
    case 'txt.endsWith':
      return verdict(
        fold(text, check.caseSensitive).endsWith(fold(check.text, check.caseSensitive)),
        null,
      );
  }
}
