/**
 * "Type the word" rules from the author's file: Latin keys map to Russian letters by physical position
 * (the keyboard is often left in the English layout), Ё equals Е when checking.
 */

export const LAYOUT: Readonly<Record<string, string>> = {
  KeyQ: 'Й',
  KeyW: 'Ц',
  KeyE: 'У',
  KeyR: 'К',
  KeyT: 'Е',
  KeyY: 'Н',
  KeyU: 'Г',
  KeyI: 'Ш',
  KeyO: 'Щ',
  KeyP: 'З',
  BracketLeft: 'Х',
  BracketRight: 'Ъ',
  KeyA: 'Ф',
  KeyS: 'Ы',
  KeyD: 'В',
  KeyF: 'А',
  KeyG: 'П',
  KeyH: 'Р',
  KeyJ: 'О',
  KeyK: 'Л',
  KeyL: 'Д',
  Semicolon: 'Ж',
  Quote: 'Э',
  KeyZ: 'Я',
  KeyX: 'Ч',
  KeyC: 'С',
  KeyV: 'М',
  KeyB: 'И',
  KeyN: 'Т',
  KeyM: 'Ь',
  Comma: 'Б',
  Period: 'Ю',
  Backquote: 'Ё',
};

export const normalizeLetter = (ch: string): string => ch.toUpperCase().replace('Ё', 'Е');

/** Character typed by a key press, or null if the key is not a letter or digit. */
export function charFromKey(key: string, code: string): { ch: string; viaLayout: boolean } | null {
  if (/^[а-яё]$/i.test(key)) return { ch: key.toUpperCase(), viaLayout: false };
  if (/^[0-9]$/.test(key)) return { ch: key, viaLayout: false };
  const mapped = LAYOUT[code];
  if (mapped && /^[a-z;'[\],.`]$/i.test(key)) return { ch: mapped, viaLayout: true };
  return null;
}

/** Per-letter check of what was typed against the word. */
export function checkWord(typed: readonly string[], word: string): boolean[] {
  return [...word].map((ch, i) => normalizeLetter(typed[i] ?? '') === normalizeLetter(ch));
}
