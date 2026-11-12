import { describe, expect, it } from 'vitest';
import { initialLocale } from '../src/index.js';

describe('initialLocale', () => {
  it('keeps a stored supported locale', () => {
    expect(initialLocale('uz')).toBe('uz');
  });

  it('falls back to the default locale', () => {
    expect(initialLocale(null)).toBe('ru');
    expect(initialLocale('en')).toBe('ru');
  });
});
