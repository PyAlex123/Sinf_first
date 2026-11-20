import { describe, expect, it } from 'vitest';
import { compile, matchPath, type RouteDef } from '../src/lib/router.svelte.js';

const load = (): never => {
  throw new Error('not loaded in tests');
};
const routes = (
  [
    { pattern: '/', load },
    { pattern: '/teacher', load },
    { pattern: '/teacher/session/:id', load },
    { pattern: '/s/:id', load },
  ] satisfies RouteDef[]
).map(compile);

describe('router', () => {
  it('matches static and parametrised routes', () => {
    expect(matchPath(routes, '/')?.route.pattern).toBe('/');
    expect(matchPath(routes, '/teacher/')?.route.pattern).toBe('/teacher');
    const m = matchPath(routes, '/teacher/session/abc-1?x=2');
    expect(m?.route.pattern).toBe('/teacher/session/:id');
    expect(m?.params).toEqual({ id: 'abc-1' });
    expect(m?.query.get('x')).toBe('2');
    expect(matchPath(routes, '/s/%D0%B0')?.params).toEqual({ id: 'а' });
  });

  it('returns undefined for unknown paths', () => {
    expect(matchPath(routes, '/teacher/session')).toBeUndefined();
    expect(matchPath(routes, '/nope')).toBeUndefined();
  });
});
