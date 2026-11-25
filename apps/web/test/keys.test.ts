import { describe, expect, it } from 'vitest';
import { turnsSlide } from '../src/lib/keys.js';

describe('slide keys', () => {
  const event = (inside: string | null, extra: Partial<Record<string, boolean>> = {}) => ({
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
    target: { closest: (selector: string) => (inside && selector.includes(inside) ? {} : null) },
  });

  it('turns the slide from the page and from a button', () => {
    expect(turnsSlide(event(null))).toBe(true);
    expect(turnsSlide({ ...event(null), target: null })).toBe(true);
  });

  it('leaves the keys to a text field, a list or a menu', () => {
    expect(turnsSlide(event('textarea'))).toBe(false);
    expect(turnsSlide(event('input'))).toBe(false);
    expect(turnsSlide(event('[role="menu"]'))).toBe(false);
    expect(turnsSlide(event('[contenteditable="true"]'))).toBe(false);
  });

  it('ignores keys with a modifier or already handled', () => {
    expect(turnsSlide(event(null, { altKey: true }))).toBe(false);
    expect(turnsSlide(event(null, { ctrlKey: true }))).toBe(false);
    expect(turnsSlide(event(null, { defaultPrevented: true }))).toBe(false);
  });
});
