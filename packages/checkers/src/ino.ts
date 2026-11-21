import type { PracticeCheck } from '@sinf/shared';
import {
  bracketProblem,
  callArguments,
  callPattern,
  stripC,
  unclosed,
  type StrippedCode,
} from './code.js';
import { verdict, type Verdict } from './verdict.js';

/**
 * Arduino sketches (`.ino`; stage 6, B5; ADR-016, addendum B5): the code is read, not compiled —
 * a school computer may have no Arduino IDE, and a check must take under a second.
 */

type InoCheck = Extract<PracticeCheck, { type: `ino.${string}` }>;

const PIN_FUNCTIONS = ['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite'];
/** Words before a name that make `name(` a definition, not a call. */
const TYPES =
  /(?:void|int|long|short|bool|boolean|byte|char|float|double|unsigned|word|String|auto|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t)\s*\*?\s*$/;

export type InoModel = StrippedCode;

export const loadIno = (text: string): InoModel => stripC(text);

/** `#define LED 13` and `const int LED = 13;`: the names a sketch gives its pins. */
function constants(code: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of code.matchAll(/^[ \t]*#define[ \t]+([A-Za-z_]\w*)[ \t]+(\S+)/gm)) {
    names.set(m[1] ?? '', m[2] ?? '');
  }
  for (const m of code.matchAll(
    /\b(?:const\s+)?(?:static\s+)?(?:int|byte|long|short|unsigned\s+int|uint8_t|int8_t|uint16_t)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z0-9_]+)\s*;/g,
  )) {
    names.set(m[1] ?? '', m[2] ?? '');
  }
  return names;
}

/** On the Uno and the Nano, the boards of a school kit, the built-in LED is pin 13. */
const samePin = (a: string, b: string): boolean => {
  const norm = (p: string): string => (p.toUpperCase() === 'LED_BUILTIN' ? '13' : p.toUpperCase());
  return norm(a) === norm(b);
};

function calls(code: string, name: string): number[] {
  const found: number[] = [];
  for (const m of code.matchAll(callPattern(name))) {
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    if (!TYPES.test(before)) found.push(m.index + m[0].length - 1);
  }
  return found;
}

export function runIno(model: InoModel, check: InoCheck): Verdict {
  const { code } = model;
  switch (check.type) {
    case 'ino.structure': {
      const setup = /\bvoid\s+setup\s*\(\s*(?:void\s*)?\)\s*\{/.test(code);
      const loop = /\bvoid\s+loop\s*\(\s*(?:void\s*)?\)\s*\{/.test(code);
      const missing = [setup ? null : 'setup', loop ? null : 'loop'].filter(Boolean).join(', ');
      return verdict(setup && loop, missing ? `нет: ${missing}` : null);
    }
    case 'ino.call': {
      const n = calls(code, check.name).length;
      return verdict(n >= check.min, `вызовов ${check.name}: ${n}`);
    }
    case 'ino.pin': {
      const names = constants(code);
      const resolve = (arg: string): string => {
        let value = arg;
        for (let hop = 0; hop < 3 && names.has(value); hop += 1) value = names.get(value) ?? value;
        return value;
      };
      const pins = new Set<string>();
      for (const fn of PIN_FUNCTIONS) {
        for (const open of calls(code, fn)) {
          const first = callArguments(code, open)[0];
          if (first) pins.add(resolve(first));
        }
      }
      const used = [...pins];
      return verdict(
        used.some((p) => samePin(p, check.pin)),
        used.length ? `пины: ${used.join(', ')}` : 'пины не используются',
      );
    }
    case 'ino.balanced': {
      if (model.unterminated) {
        return verdict(false, unclosed(model.unterminated));
      }
      const problem = bracketProblem(code);
      return verdict(!problem, problem);
    }
  }
}
