import { parse, parseFragment, serialize } from 'parse5';
import { describe, expect, it } from 'vitest';
import {
  hasActiveContent,
  isAllowedUrl,
  isSafeCss,
  sanitizeTree,
} from '../../src/import/sanitize.js';

const clean = (html: string): string => {
  const tree = parseFragment(html);
  sanitizeTree(tree);
  expect(hasActiveContent(tree)).toBe(false);
  return serialize(tree);
};

describe('sanitizeTree', () => {
  it('removes scripts, frames and event handlers', () => {
    const out = clean(
      '<div onclick="steal()"><script>alert(1)</script><iframe src="https://x"></iframe><button onmouseover="x()">ok</button></div>',
    );
    expect(out).toBe('<div><button>ok</button></div>');
  });

  it('keeps fragment and platform URLs, drops the rest', () => {
    const out = clean(
      '<svg><use href="#g01"></use><image href="/content/c/media/a.webp"></image><image href="https://evil/x.png"></image></svg><a href="javascript:alert(1)">x</a>',
    );
    expect(out).toContain('href="#g01"');
    expect(out).toContain('href="/content/c/media/a.webp"');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('javascript');
  });

  it('drops xlink:href and data URLs that were not converted', () => {
    const out = clean('<svg><image xlink:href="data:image/png;base64,AAAA"></image></svg>');
    expect(out).not.toContain('data:');
  });

  it('removes SVG animations that rewrite href', () => {
    const out = clean(
      '<svg><a href="#x"><set attributeName="href" to="javascript:alert(1)"></set>t</a></svg>',
    );
    expect(out).not.toContain('set');
  });

  it('removes unsafe inline styles and keeps safe ones', () => {
    expect(clean('<p style="color:red">a</p>')).toBe('<p style="color:red">a</p>');
    expect(clean('<p style="background:url(https://x/y.png)">a</p>')).toBe('<p>a</p>');
  });

  it('cleans whole documents: keeps safe <style>, removes meta refresh and links', () => {
    const doc = parse(
      '<html><head><meta http-equiv="refresh" content="0;url=https://x"><link rel="stylesheet" href="https://x.css"><style>b{color:red}</style></head><body><b>t</b></body></html>',
    );
    sanitizeTree(doc);
    const out = serialize(doc);
    expect(out).toContain('<style>b{color:red}</style>');
    expect(out).not.toContain('refresh');
    expect(out).not.toContain('x.css');
  });
});

describe('isSafeCss / isAllowedUrl', () => {
  it('accepts plain CSS and fragment urls', () => {
    expect(isSafeCss('.a{fill:url(#dsk)} .b{color:#fff}')).toBe(true);
  });

  it('rejects imports and external urls', () => {
    expect(isSafeCss('@import "x.css";')).toBe(false);
    expect(isSafeCss('.a{background:url("https://x/y.png")}')).toBe(false);
    expect(isSafeCss('.a{background:url(data:image/png;base64,AA)}')).toBe(false);
  });

  it('allows only fragments and /content/ URLs', () => {
    expect(isAllowedUrl('#a')).toBe(true);
    expect(isAllowedUrl('/content/x/media/a.webp')).toBe(true);
    expect(isAllowedUrl('/api/x')).toBe(false);
    expect(isAllowedUrl('lesson.html')).toBe(false);
  });
});
