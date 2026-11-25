import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from '@sinf/shared';
import ru from './ru.json';
import uz from './uz.json';

/**
 * Minimal i18n (CLAUDE.md §3.5): flat key → string dictionaries, `{name}` placeholders, the locale is remembered in
 * localStorage. Lesson content stays in Russian; only the platform UI is translated.
 *
 * Uzbek and Russian are in the first bundle; English (stage 6, B3) is its own chunk, loaded when it
 * is chosen — a classroom computer in Uzbekistan never pays for it.
 */

type Dictionary = Record<string, string>;
const dictionaries: Partial<Record<Locale, Dictionary>> = { ru, uz };

async function loadDictionary(locale: Locale): Promise<void> {
  if (dictionaries[locale]) return;
  if (locale === 'en') dictionaries.en = (await import('./en.json')).default;
}
const STORAGE_KEY = 'sinf.locale';

function storedLocale(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isLocale(value)) return value;
  } catch {
    // storage may be unavailable (private mode); fall through
  }
  return DEFAULT_LOCALE;
}

/**
 * Russian needs three forms after a number ("1 ученик", "2 ученика", "5 учеников"); Uzbek needs
 * none. A key may therefore carry `<key>#one` / `#few` / `#many` beside the plain `<key>`, and the
 * form is chosen from the `count` (or `sec`) placeholder. Without those keys nothing changes.
 * The separator is `#`, not a dot: a dot is already part of ordinary key names (`session.lock.one`).
 */
function russianForm(n: number): 'one' | 'few' | 'many' {
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 14) return 'many';
  const unit = abs % 10;
  if (unit === 1) return 'one';
  if (unit >= 2 && unit <= 4) return 'few';
  return 'many';
}

function pluralKey(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string | null {
  if (locale === 'uz' || !params) return null;
  const n = params['count'] ?? params['sec'];
  if (typeof n !== 'number') return null;
  // English: `#one` for one, the plain key — the plural — for every other number.
  if (locale === 'en') return Math.abs(n) === 1 ? `${key}#one` : null;
  return `${key}#${russianForm(n)}`;
}

class I18n {
  /** A stored language whose dictionary is not loaded yet starts in Russian and switches once it is. */
  locale = $state<Locale>(dictionaries[storedLocale()] ? storedLocale() : DEFAULT_LOCALE);

  readonly locales = LOCALES;

  /** Lessons and criteria are written in Russian and Uzbek only (B3): English shows them in Russian. */
  get contentLocale(): 'ru' | 'uz' {
    return this.locale === 'uz' ? 'uz' : 'ru';
  }

  constructor() {
    const wanted = storedLocale();
    if (!dictionaries[wanted]) void this.set(wanted);
  }

  async set(locale: Locale): Promise<void> {
    try {
      await loadDictionary(locale);
    } catch {
      return; // offline and not cached: stay in the language there is
    }
    this.locale = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }

  /** Translates a key; missing keys fall back to Russian, then to the key itself (visible in dev). */
  t(key: string, params?: Record<string, string | number>): string {
    const plural = pluralKey(this.locale, key, params);
    const dictionary = dictionaries[this.locale] ?? dictionaries.ru ?? {};
    const template =
      (plural ? dictionary[plural] : undefined) ??
      dictionary[key] ??
      (plural ? dictionaries.ru?.[plural] : undefined) ??
      dictionaries.ru?.[key] ??
      key;
    return format(template, params);
  }
}

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export const i18n = new I18n();
/** Shorthand for templates: `{t('home.title')}`. Reactive through `i18n.locale`. */
export const t = (key: string, params?: Record<string, string | number>): string =>
  i18n.t(key, params);

/** Names of the locales in their own language, for the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  uz: 'O‘zbekcha',
  ru: 'Русский',
  en: 'English',
};

/** The language tag for dates and numbers in the browser's own formatting. */
export function localeTag(locale: Locale): string {
  return locale === 'uz' ? 'uz-UZ' : locale === 'en' ? 'en-GB' : 'ru-RU';
}
