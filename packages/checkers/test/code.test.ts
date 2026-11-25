import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CriterionSchema, type CheckReport, type Criterion } from '@sinf/shared';
import { checkFile } from '../src/index.js';
import { loadPy, syntaxProblem } from '../src/py.js';

/**
 * Stage 6, B5: Scratch, Arduino and Python on reference files "right / wrong" (CLAUDE.md §9.6),
 * made by tools/fixtures/make_checker_fixtures.py.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const file = (path: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, path)));
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function criteria(checks: Record<string, unknown>): Criterion[] {
  return Object.entries(checks).map(([id, check]) =>
    CriterionSchema.parse({ id, kind: 'auto', label: { ru: id, uz: id }, points: 1, check }),
  );
}

const outcomes = (report: CheckReport): Record<string, string> =>
  Object.fromEntries(report.results.map((r) => [r.id, r.outcome]));
const found = (report: CheckReport, id: string): string | null | undefined =>
  report.results.find((r) => r.id === id)?.found;

// ---------- sb3

const SB3 = criteria({
  sprites: { type: 'sb3.sprites', min: 2 },
  flag: { type: 'sb3.flag' },
  loop: { type: 'sb3.loop' },
  condition: { type: 'sb3.condition' },
  variable: { type: 'sb3.variable', min: 2 },
  sound: { type: 'sb3.sound' },
  blocks: { type: 'sb3.blocks', min: 6 },
  move: { type: 'sb3.block', opcode: 'motion_movesteps' },
});

describe('sb3 (Scratch)', () => {
  it('passes a project done right, on every criterion', () => {
    const report = checkFile(file('sb3/good.sb3'), 'Игра.sb3', SB3);
    expect(report.file).toBe('ok');
    expect(
      Object.values(outcomes(report)).every((o) => o === 'pass'),
      JSON.stringify(report),
    ).toBe(true);
    // The menus inside blocks are not blocks, and a lone variable on the workspace is not either.
    expect(found(report, 'blocks')).toBe('блоков: 7');
  });

  it('fails what is missing and says what it found', () => {
    const report = checkFile(file('sb3/bad.sb3'), 'Игра.sb3', SB3);
    expect(outcomes(report)).toEqual({
      sprites: 'fail',
      flag: 'fail',
      loop: 'fail',
      condition: 'fail',
      variable: 'fail',
      sound: 'fail',
      blocks: 'fail',
      move: 'pass',
    });
    expect(found(report, 'sprites')).toBe('спрайтов: 1');
  });

  it('does not grade a file that is not a project', () => {
    expect(checkFile(bytes('{"targets": []}'), 'Игра.sb3', SB3).file).toBe('unreadable');
    // A ZIP without project.json (a sprite exported as .sprite3, renamed).
    const zip = file('pptx/good.pptx');
    expect(checkFile(zip, 'Игра.sb3', SB3).file).toBe('unreadable');
  });
});

// ---------- ino

const INO = criteria({
  structure: { type: 'ino.structure' },
  pinMode: { type: 'ino.call', name: 'pinMode', min: 2 },
  serial: { type: 'ino.call', name: 'Serial.begin' },
  delay: { type: 'ino.call', name: 'delay', min: 2 },
  pin13: { type: 'ino.pin', pin: '13' },
  builtin: { type: 'ino.pin', pin: 'LED_BUILTIN' },
  pin2: { type: 'ino.pin', pin: '2' },
  balanced: { type: 'ino.balanced' },
  words: { type: 'txt.contains', text: 'светодиод' },
});

describe('ino (Arduino)', () => {
  it('passes a sketch done right, on every criterion', () => {
    const report = checkFile(file('ino/good.ino'), 'blink.ino', INO);
    expect(report.file).toBe('ok');
    expect(
      Object.values(outcomes(report)).every((o) => o === 'pass'),
      JSON.stringify(report),
    ).toBe(true);
    expect(found(report, 'pin13')).toBe('пины: 13, 2');
  });

  it('fails what is missing', () => {
    const report = checkFile(file('ino/bad.ino'), 'blink.ino', INO);
    expect(outcomes(report)).toEqual({
      structure: 'fail',
      pinMode: 'fail',
      serial: 'fail',
      delay: 'fail',
      pin13: 'fail',
      builtin: 'fail',
      pin2: 'fail',
      balanced: 'fail',
      words: 'fail',
    });
    expect(found(report, 'structure')).toBe('нет: loop');
    expect(found(report, 'balanced')).toBe('строка 8: лишняя «}»');
    expect(found(report, 'pin13')).toBe('пины: 12');
  });

  it('does not count a definition as a call, nor a word in a comment or a string', () => {
    const sketch = `void delay2() {}\nvoid setup() { /* delay(1); */ Serial.print("delay(5)"); }\nvoid loop() {}`;
    const report = checkFile(bytes(sketch), 's.ino', INO);
    expect(outcomes(report).delay).toBe('fail');
    expect(found(report, 'delay')).toBe('вызовов delay: 0');
    expect(outcomes(report).structure).toBe('pass');
    const open = checkFile(bytes('void setup() { Serial.print("oops); }'), 's.ino', INO);
    expect(found(open, 'balanced')).toBe('строка 1: строка в кавычках не закрыта');
  });
});

// ---------- py

const PY = criteria({
  anyFunction: { type: 'py.function' },
  total: { type: 'py.function', name: 'total' },
  name: { type: 'py.variable', name: 'name' },
  s: { type: 'py.variable', name: 's' },
  n: { type: 'py.variable', name: 'n' },
  for: { type: 'py.uses', construct: 'for' },
  while: { type: 'py.uses', construct: 'while' },
  if: { type: 'py.uses', construct: 'if' },
  input: { type: 'py.uses', construct: 'input' },
  print: { type: 'py.uses', construct: 'print' },
  list: { type: 'py.uses', construct: 'list' },
  return: { type: 'py.uses', construct: 'return' },
  hello: { type: 'py.prints', text: 'привет' },
  sum: { type: 'py.prints', text: 'Сумма', caseSensitive: true },
  syntax: { type: 'py.syntax' },
});

describe('py (Python)', () => {
  it('passes a program done right, on every criterion', () => {
    const report = checkFile(file('py/good.py'), 'sum.py', PY);
    expect(report.file).toBe('ok');
    expect(
      Object.values(outcomes(report)).every((o) => o === 'pass'),
      JSON.stringify(report),
    ).toBe(true);
  });

  it('fails what is missing, and finds the missing colon', () => {
    const report = checkFile(file('py/bad.py'), 'sum.py', PY);
    const o = outcomes(report);
    expect(o.anyFunction).toBe('fail');
    expect(o.for).toBe('fail');
    expect(o.while).toBe('fail');
    expect(o.input).toBe('pass');
    expect(o.name).toBe('pass');
    expect(o.hello).toBe('fail');
    expect(o.syntax).toBe('fail');
    expect(found(report, 'syntax')).toBe('строка 2: нет двоеточия');
    expect(found(report, 'anyFunction')).toBe('функций нет');
  });

  it('does not take words in strings or comments for code', () => {
    const report = checkFile(
      bytes('# for x in y: while True\ntext = "for i in range(3): print(1)"\n'),
      'a.py',
      PY,
    );
    expect(outcomes(report).for).toBe('fail');
    expect(outcomes(report).while).toBe('fail');
    expect(outcomes(report).print).toBe('fail');
    expect(outcomes(report).syntax).toBe('pass');
  });

  it.each([
    ['if x:\n', 'строка 1: после двоеточия нет блока с отступом'],
    ['x = 1\n    y = 2\n', 'строка 2: лишний отступ'],
    ['if x:\n    a = 1\n  b = 2\n', 'строка 3: отступ не совпадает с блоком'],
    ['print("Salom)\n', 'строка 1: строка в кавычках не закрыта'],
    ['print((1)\nx = 2\n', 'строка 1: «(» не закрыта'],
    ['for i in range(3)\n    print(i)\n', 'строка 1: нет двоеточия'],
    [
      'if x:\n\ty = 1\nif z:\n    w = 2\n',
      'отступы и табуляцией, и пробелами — выберите что-то одно',
    ],
  ])('finds what Python would refuse: %j', (source, problem) => {
    expect(syntaxProblem(loadPy(source))).toBe(problem);
  });

  it.each([
    'if x: y = 1\n',
    'd = {\n  "a": 1,\n  "b": [1,\n 2],\n}\n',
    'x = 1 + \\\n    2\n',
    'class A:\n    def f(self):\n        return [i for i in range(3) if i]\n\n\nA().f()\n',
    'try:\n    x = int("5")\nexcept ValueError:\n    pass\nelse:\n    print(x)\nfinally:\n    print("ok")\n',
    "s = '''\n  не код:\nif'''\nprint(s[1:])\n",
    'f = lambda x: x * 2\nprint(f(2))\r\n',
  ])('accepts what Python accepts: %j', (source) => {
    expect(syntaxProblem(loadPy(source))).toBeNull();
  });
});
