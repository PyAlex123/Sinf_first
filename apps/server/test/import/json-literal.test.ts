import { describe, expect, it } from 'vitest';
import { extractJsonAssignment, scanJsonValue } from '../../src/import/json-literal.js';

describe('extractJsonAssignment', () => {
  const code = `const TITLE = "1 класс", TEACHER = "t.html", APPS = [{"id":"g10","html":"<b>]}</b>","q":"\\"[x\\""}], PICS = {"sun":"<svg/>"};
let idx = 0;`;

  it('reads comma-chained declarations without evaluating code', () => {
    expect(extractJsonAssignment(code, 'TITLE')).toBe('1 класс');
    expect(extractJsonAssignment(code, 'APPS')).toEqual([
      { id: 'g10', html: '<b>]}</b>', q: '"[x"' },
    ]);
    expect(extractJsonAssignment(code, 'PICS')).toEqual({ sun: '<svg/>' });
  });

  it('does not match a name that is only a suffix of another', () => {
    expect(() => extractJsonAssignment('const MYAPPS = []', 'APPS')).toThrow(/not found/);
  });

  it('rejects values that are not JSON literals', () => {
    expect(() => extractJsonAssignment('const APPS = makeApps();', 'APPS')).toThrow();
    expect(() => extractJsonAssignment('const APPS = [1, 2', 'APPS')).toThrow(/Unterminated/);
  });

  it('finds the end of nested values', () => {
    const src = 'x=[[1,{"a":"]"}],2];';
    expect(src.slice(2, scanJsonValue(src, 2))).toBe('[[1,{"a":"]"}],2]');
  });
});
