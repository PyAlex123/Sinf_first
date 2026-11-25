import { describe, expect, it } from 'vitest';
import ru from '../src/lib/i18n/ru.json';
import uz from '../src/lib/i18n/uz.json';
import en from '../src/lib/i18n/en.json';
import { format, i18n } from '../src/lib/i18n/index.svelte.js';

/**
 * `<key>#one|few|many` are the Russian plural forms of `<key>` (ADR-010). Uzbek takes one form
 * after a number, so it carries the plain key only — these variants are deliberately ru-only.
 */
const PLURAL = /#(one|few|many)$/;
const base = (keys: string[]): string[] => keys.filter((key) => !PLURAL.test(key));

describe('i18n dictionaries', () => {
  it('have the same keys in ru and uz', () => {
    expect(base(Object.keys(uz)).sort()).toEqual(base(Object.keys(ru)).sort());
  });

  it('use the same placeholders in both languages', () => {
    for (const [key, value] of Object.entries(ru)) {
      const a = (value.match(/\{\w+\}/g) ?? []).sort();
      const uzKey = key.replace(PLURAL, '');
      const b = ((uz as Record<string, string>)[uzKey]?.match(/\{\w+\}/g) ?? []).sort();
      expect(b, key).toEqual(a);
    }
  });

  it('has all three forms wherever one of them exists', () => {
    for (const key of Object.keys(ru)) {
      if (!PLURAL.test(key)) continue;
      const stem = key.replace(PLURAL, '');
      const keys = Object.keys(ru);
      for (const form of ['one', 'few', 'many']) {
        expect(keys, stem).toContain(`${stem}#${form}`);
      }
      expect(keys, stem).toContain(stem);
    }
  });
});

describe('the English dictionary (stage 6, B3)', () => {
  const english = en as Record<string, string>;

  it('has every key of the Russian one, and a singular only where Russian has forms', () => {
    const plain = (keys: string[]) => keys.filter((k) => !/#(one|few|many)$/.test(k)).sort();
    expect(plain(Object.keys(english))).toEqual(plain(Object.keys(ru)));
    for (const key of Object.keys(english)) {
      if (!key.endsWith('#one')) continue;
      expect(Object.keys(ru), key).toContain(key);
    }
    expect(Object.keys(english).some((k) => /#(few|many)$/.test(k))).toBe(false);
  });

  it('uses the same placeholders', () => {
    for (const [key, value] of Object.entries(english)) {
      const a = (value.match(/\{\w+\}/g) ?? []).sort();
      const b = ((ru as Record<string, string>)[key]?.match(/\{\w+\}/g) ?? []).sort();
      expect(a, key).toEqual(b);
    }
  });

  it('says one and many once it is loaded', async () => {
    await i18n.set('en');
    expect(i18n.locale).toBe('en');
    expect(i18n.t('teacher.students', { count: 1 })).toBe(
      english['teacher.students#one']?.replace('{count}', '1'),
    );
    expect(i18n.t('teacher.students', { count: 2 })).toBe(
      english['teacher.students']?.replace('{count}', '2'),
    );
    i18n.locale = 'ru';
  });
});

describe('russian plurals', () => {
  it('agrees with the number', () => {
    i18n.locale = 'ru';
    expect(i18n.t('teacher.students', { count: 1 })).toBe('1 ученик');
    expect(i18n.t('teacher.students', { count: 2 })).toBe('2 ученика');
    expect(i18n.t('teacher.students', { count: 5 })).toBe('5 учеников');
    expect(i18n.t('teacher.students', { count: 11 })).toBe('11 учеников');
    expect(i18n.t('teacher.students', { count: 21 })).toBe('21 ученик');
    expect(i18n.t('teacher.students', { count: 112 })).toBe('112 учеников');
  });

  it('keeps the single Uzbek form', () => {
    i18n.locale = 'uz';
    expect(i18n.t('teacher.students', { count: 2 })).toBe(
      (uz as Record<string, string>)['teacher.students']?.replace('{count}', '2'),
    );
    i18n.locale = 'ru';
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(format('Урок {num} из {total}', { num: 3, total: 14 })).toBe('Урок 3 из 14');
    expect(format('{a} {b}', { a: 'x' })).toBe('x {b}');
    expect(format('plain')).toBe('plain');
  });
});
