import { z } from 'zod';

/** Interface languages: Uzbek and Russian from day one (CLAUDE.md §3.5), English since stage 6 (B3). */
export const LOCALES = ['uz', 'ru', 'en'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

export const DEFAULT_LOCALE: Locale = 'ru';

export function isLocale(value: unknown): value is Locale {
  return LocaleSchema.safeParse(value).success;
}
