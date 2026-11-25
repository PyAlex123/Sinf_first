import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, LOCALES } from '../src/index.js';

describe('locales', () => {
  it('supports uz, ru and en', () => {
    expect(LOCALES).toEqual(['uz', 'ru', 'en']);
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isLocale('de')).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});
