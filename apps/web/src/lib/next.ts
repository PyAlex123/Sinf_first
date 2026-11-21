/**
 * Where to go after signing in (stage 5, A6): the page that sent the teacher to sign in, e.g. an
 * invitation link. Only a path on this site — never another address (an "open redirect").
 */
export function nextPath(
  search: string = typeof location === 'undefined' ? '' : location.search,
): string | null {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return null;
  return next;
}

/** A link to another page that keeps the same "next". */
export function withNext(path: string, next: string | null = nextPath()): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
