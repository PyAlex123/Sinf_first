import { expect } from 'vitest';

/** Every tag closes in order and nothing stray is left between them — enough for our own XML. */
export function expectWellFormed(xml: string): void {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    const between = body.slice(last, m.index);
    expect(between, `stray markup before <${m[2]}>`).not.toMatch(/[<>]/);
    expect(between, 'bare ampersand').not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    last = tag.lastIndex;
    const [, closing, name, , selfClosing] = m;
    if (selfClosing) continue;
    if (closing) expect(stack.pop(), `</${name}> closes something else`).toBe(name);
    else stack.push(name as string);
  }
  expect(body.slice(last).trim()).toBe('');
  expect(stack).toEqual([]);
}
