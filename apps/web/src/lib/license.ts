import { ApiError } from './api.js';
import { t } from './i18n/index.svelte.js';

/**
 * What a refusal by the license means, in the teacher's words (stage 6, B2); null for any other
 * error. The server says why by its code: the school has no license, it used all its classes, a
 * personal class is a website class, the free plan has one personal class.
 */
export function licenseError(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  switch (e.code) {
    case 'license_needed':
      return t('license.needed');
    case 'license_limit':
      return t('license.limit', { limit: Number(e.details?.['limit'] ?? 0) });
    case 'license_personal':
      return t('license.personal');
    case 'free_limit':
      return t('license.free');
    default:
      return null;
  }
}
