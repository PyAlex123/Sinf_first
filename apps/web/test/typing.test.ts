import { describe, expect, it } from 'vitest';
import { charFromKey, checkWord, normalizeLetter } from '../src/player/lib/typing.js';

describe('typing', () => {
  it('maps Latin keys to Russian letters by position', () => {
    expect(charFromKey('v', 'KeyV')).toEqual({ ch: 'М', viaLayout: true });
    expect(charFromKey('z', 'KeyZ')).toEqual({ ch: 'Я', viaLayout: true });
    expect(charFromKey(',', 'Comma')).toEqual({ ch: 'Б', viaLayout: true });
  });

  it('accepts Russian letters and digits directly', () => {
    expect(charFromKey('м', 'KeyV')).toEqual({ ch: 'М', viaLayout: false });
    expect(charFromKey('7', 'Digit7')).toEqual({ ch: '7', viaLayout: false });
    expect(charFromKey('Shift', 'ShiftLeft')).toBeNull();
    expect(charFromKey('-', 'Minus')).toBeNull();
  });

  it('checks letter by letter, Ё counts as Е', () => {
    expect(checkWord(['М', 'Я', 'Ч'], 'МЯЧ')).toEqual([true, true, true]);
    expect(checkWord(['М', 'А', 'Ч'], 'МЯЧ')).toEqual([true, false, true]);
    expect(checkWord(['Ё', 'Ж'], 'ЕЖ')).toEqual([true, true]);
    expect(checkWord(['М'], 'МЯЧ')).toEqual([true, false, false]);
    expect(normalizeLetter('ё')).toBe('Е');
  });
});
