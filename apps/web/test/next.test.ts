import { describe, expect, it } from 'vitest';
import { nextPath, withNext } from '../src/lib/next.js';

/** A6: after signing in, back to the page that asked — on this site only. */

describe('where to go after signing in', () => {
  it('takes a path of this site', () => {
    expect(nextPath('?next=%2Finvite%2Fabc')).toBe('/invite/abc');
    expect(withNext('/teacher/login', '/invite/abc')).toBe('/teacher/login?next=%2Finvite%2Fabc');
    expect(withNext('/teacher/login', null)).toBe('/teacher/login');
  });

  it('never another site', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'invite', '']) {
      expect(nextPath(`?next=${encodeURIComponent(bad)}`), bad).toBeNull();
    }
    expect(nextPath('')).toBeNull();
  });
});
