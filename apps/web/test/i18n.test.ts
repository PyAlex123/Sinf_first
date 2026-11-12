import { describe, expect, it } from 'vitest';
import ru from '../src/lib/i18n/ru.json';
import uz from '../src/lib/i18n/uz.json';
import { format } from '../src/lib/i18n/index.svelte.js';

describe('i18n dictionaries', () => {
  it('have the same keys in ru and uz', () => {
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
  });

  it('use the same placeholders in both languages', () => {
    for (const [key, value] of Object.entries(ru)) {
      const a = (value.match(/\{\w+\}/g) ?? []).sort();
      const b = ((uz as Record<string, string>)[key]?.match(/\{\w+\}/g) ?? []).sort();
      expect(b, key).toEqual(a);
    }
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(format('Урок {num} из {total}', { num: 3, total: 14 })).toBe('Урок 3 из 14');
    expect(format('{a} {b}', { a: 'x' })).toBe('x {b}');
    expect(format('plain')).toBe('plain');
  });
});
