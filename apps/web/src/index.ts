import { DEFAULT_LOCALE, type Locale } from '@sinf/shared';

/** Placeholder until step S1.4 replaces this package with a Svelte 5 + Vite app. */
export function initialLocale(stored: string | null): Locale {
  return stored === 'uz' || stored === 'ru' ? stored : DEFAULT_LOCALE;
}
