import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from '@sinf/shared';
import ru from './ru.json';
import uz from './uz.json';

/**
 * Minimal i18n (CLAUDE.md §3.5): flat key → string dictionaries, `{name}` placeholders, the locale is remembered in
 * localStorage. Lesson content stays in Russian; only the platform UI is translated.
 */

type Dictionary = Record<string, string>;
const dictionaries: Record<Locale, Dictionary> = { ru, uz };
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

class I18n {
  locale = $state<Locale>(storedLocale());

  readonly locales = LOCALES;

  set(locale: Locale): void {
    this.locale = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    document.documentElement.lang = locale;
  }

  /** Translates a key; missing keys fall back to Russian, then to the key itself (visible in dev). */
  t(key: string, params?: Record<string, string | number>): string {
    return format(dictionaries[this.locale][key] ?? dictionaries.ru[key] ?? key, params);
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
export const LOCALE_NAMES: Record<Locale, string> = { uz: 'O‘zbekcha', ru: 'Русский' };
