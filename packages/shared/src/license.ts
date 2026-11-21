import { z } from 'zod';

/**
 * Licenses (CLAUDE.md §2; PLAN.md 2.6–2.7; stage 6, B2; ADR-022). A school pays for N classes for a
 * period; what it pays for are the classes of the school, lessons on the classroom computers and
 * the school's reports. A teacher's own work on the website — web lessons, the journal, the KTP and
 * one personal class — stays free.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A classroom computer keeps teaching this long after the license ends while it cannot ask. */
export const LICENSE_GRACE_DAYS = 14;
/** A teacher's personal classes on the free plan (CLAUDE.md §2: "один личный класс"). */
export const FREE_PERSONAL_CLASSES = 1;

export const LicenseTermsSchema = z.strictObject({
  classesLimit: z.number().int().min(1).max(500),
  validFrom: day,
  validTo: day,
});
export type LicenseTerms = z.infer<typeof LicenseTermsSchema>;

export const IssueLicenseSchema = LicenseTermsSchema.extend({
  note: z.string().trim().max(200).default(''),
}).refine((l) => l.validFrom <= l.validTo, { message: 'The license ends before it begins' });
export type IssueLicense = z.infer<typeof IssueLicenseSchema>;

export const LicenseSchema = LicenseTermsSchema.extend({
  id: z.string().min(1),
  note: z.string(),
  createdAt: z.string().min(1),
  revokedAt: z.string().nullable(),
});
export type License = z.infer<typeof LicenseSchema>;

/**
 * `active` — paid for today; `grace` — ended, but a classroom computer still teaches; `expired`;
 * `future` — paid from a later day; `none` — never had one.
 */
export const LicenseStatusSchema = z.enum(['active', 'grace', 'expired', 'future', 'none']);
export type LicenseStatus = z.infer<typeof LicenseStatusSchema>;

export const SchoolLicenseSchema = z.strictObject({
  terms: LicenseTermsSchema.nullable(),
  status: LicenseStatusSchema,
  /** Classes of the school now. */
  classesUsed: z.number().int().nonnegative(),
});
export type SchoolLicense = z.infer<typeof SchoolLicenseSchema>;

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
};

/** Where these terms stand on `today` (`yyyy-mm-dd`, the school's day). */
export function licenseStatus(terms: LicenseTerms | null, today: string): LicenseStatus {
  if (!terms) return 'none';
  if (today < terms.validFrom) return 'future';
  if (today <= terms.validTo) return 'active';
  if (today <= addDays(terms.validTo, LICENSE_GRACE_DAYS)) return 'grace';
  return 'expired';
}

export const SuperadminLicensesResponseSchema = z.strictObject({
  licenses: z.array(LicenseSchema),
});
export type SuperadminLicensesResponse = z.infer<typeof SuperadminLicensesResponseSchema>;
