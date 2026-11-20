import { describe, expect, it } from 'vitest';
import { scopeCss, scopeSelectorList } from '../../src/import/scope-css.js';

describe('scopeCss', () => {
  it('maps root/html/body to the root class and prefixes everything else', () => {
    const css = `:root{--a:1}html,body{margin:0}body{display:flex}*{box-sizing:border-box}
.bar{height:64px}#stage{flex:1}.nb.go2,.nb:disabled{opacity:.3}body.home .nav{visibility:hidden}kbd{font:700 18px Arial}`;
    expect(scopeCss(css, '.lesson-root')).toBe(
      [
        '.lesson-root{--a:1}',
        '.lesson-root{margin:0}',
        '.lesson-root{display:flex}',
        '.lesson-root *{box-sizing:border-box}',
        '.lesson-root .bar{height:64px}',
        '.lesson-root .stage{flex:1}',
        '.lesson-root .nb.go2,.lesson-root .nb:disabled{opacity:.3}',
        '.lesson-root.home .nav{visibility:hidden}',
        '.lesson-root kbd{font:700 18px Arial}',
        '',
      ].join('\n'),
    );
  });

  it('recurses into @media and leaves @keyframes alone', () => {
    const css = `@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}.hl{animation:pulse 1s}
@media (max-width:860px){.khead{display:none}.krow{grid-template-columns:1fr}}`;
    expect(scopeCss(css, '.x')).toBe(
      [
        '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}',
        '.x .hl{animation:pulse 1s}',
        '@media (max-width:860px){.x .khead{display:none}\n.x .krow{grid-template-columns:1fr}\n}',
        '',
      ].join('\n'),
    );
  });

  it('ignores comments and keeps commas inside functions', () => {
    expect(scopeCss('/* note */ .a{color:red} /* x */', '.r')).toBe('.r .a{color:red}\n');
    expect(scopeSelectorList(':is(.a,.b) .c, .d', '.r')).toBe('.r :is(.a,.b) .c,.r .d');
  });

  it('scopes the real lesson stylesheet without leaving global selectors', () => {
    const scoped = scopeCss(
      `:root{--ink:#1f2a37}*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:Arial;display:flex}button{font:inherit}.slide{position:absolute}`,
      '.lesson-root',
    );
    for (const line of scoped.trim().split('\n')) {
      expect(line.startsWith('.lesson-root'), line).toBe(true);
    }
  });
});
