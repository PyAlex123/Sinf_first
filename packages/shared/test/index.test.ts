import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, LOCALES } from '../src/index.js';

describe('locales', () => {
  it('supports uz and ru', () => {
    expect(LOCALES).toEqual(['uz', 'ru']);
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isLocale('en')).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});
