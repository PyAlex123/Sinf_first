/**
 * Shared contracts between server and web.
 * Zod schemas for lessons, API and the session protocol are added starting from step S1.2.
 */

/** Interface languages supported from day one (CLAUDE.md §3.5). */
export const LOCALES = ['uz', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ru';

/** Version of the realtime protocol; every message carries it in the `v` field (CLAUDE.md §5.6). */
export const PROTOCOL_VERSION = 1;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
