import { z } from 'zod';

/** Interface languages supported from day one (CLAUDE.md §3.5). */
export const LOCALES = ['uz', 'ru'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

export const DEFAULT_LOCALE: Locale = 'ru';

export function isLocale(value: unknown): value is Locale {
  return LocaleSchema.safeParse(value).success;
}
