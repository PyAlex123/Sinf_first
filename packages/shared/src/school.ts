import { z } from 'zod';
import { FILE_QUOTA_BYTES, MAX_FILE_BYTES } from './files.js';
import { DEFAULT_KTP_CHANGE_PERCENT } from './ktp.js';
import { LESSON_APPS, LessonAppSchema } from './protocol.js';

/**
 * The rules of a school (CLAUDE.md §3.4, §4.9, §4.10, §6 School.settings; stage 5, A1; ADR-021):
 * what its administrator decides once for every class. A personal class of a teacher follows the
 * defaults.
 */

const MB = 1024 * 1024;
export const MAX_QUOTA_MB = FILE_QUOTA_BYTES / MB;
export const MAX_FILE_MB = MAX_FILE_BYTES / MB;

/** A day of the year as `MM-DD`; 29 February is not one every year, so it is not offered. */
const monthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine((v) => {
    const [m, d] = v.split('-').map(Number);
    const date = new Date(Date.UTC(2001, (m ?? 1) - 1, d ?? 1));
    return date.getUTCMonth() === (m ?? 1) - 1 && date.getUTCDate() === d;
  }, 'No such day');

const fields = {
  /** How much of a KTP its teacher may change (W11). */
  ktpChangePercent: z.number().int().min(0).max(100),
  /** "Мои работы" of one child, at most the platform's 200 MB. */
  fileQuotaMb: z.number().int().min(1).max(MAX_QUOTA_MB),
  /** One file, at most the platform's 50 MB. */
  maxFileMb: z.number().int().min(1).max(MAX_FILE_MB),
  /** Works and screenshots are kept until this day after their school year, then deleted (A4). */
  keepWorksUntil: monthDay,
  /** The programs a lesson may open on the school's computers (ApprovedApp, A3). */
  apps: z.array(LessonAppSchema).max(LESSON_APPS.length),
};

export const DEFAULT_SCHOOL_SETTINGS = {
  ktpChangePercent: DEFAULT_KTP_CHANGE_PERCENT,
  fileQuotaMb: MAX_QUOTA_MB,
  maxFileMb: MAX_FILE_MB,
  keepWorksUntil: '07-31',
  apps: [...LESSON_APPS],
};

/**
 * What is stored, read leniently: a missing or broken value is its default, so an old school row
 * (`{}` or `{ ktpChangePercent }`) is always a whole set of rules.
 */
export const SchoolSettingsSchema = z.object({
  ktpChangePercent: fields.ktpChangePercent.catch(DEFAULT_SCHOOL_SETTINGS.ktpChangePercent),
  fileQuotaMb: fields.fileQuotaMb.catch(DEFAULT_SCHOOL_SETTINGS.fileQuotaMb),
  maxFileMb: fields.maxFileMb.catch(DEFAULT_SCHOOL_SETTINGS.maxFileMb),
  keepWorksUntil: fields.keepWorksUntil.catch(DEFAULT_SCHOOL_SETTINGS.keepWorksUntil),
  apps: fields.apps
    .transform((apps) => LESSON_APPS.filter((a) => apps.includes(a)))
    .catch([...DEFAULT_SCHOOL_SETTINGS.apps]),
});
export type SchoolSettings = z.infer<typeof SchoolSettingsSchema>;

export function readSchoolSettings(raw: unknown): SchoolSettings {
  const settings = SchoolSettingsSchema.parse(raw ?? {});
  // A file bigger than the whole folder cannot be kept: the smaller of the two stands.
  return { ...settings, maxFileMb: Math.min(settings.maxFileMb, settings.fileQuotaMb) };
}

/** What the administrator changes; a field left out stays as it is. */
export const UpdateSchoolSettingsSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateSchoolSettings = z.infer<typeof UpdateSchoolSettingsSchema>;

/** When the school's next cleaning of old works is, and what it would take if it ran today (A4). */
export const RetentionPreviewSchema = z.strictObject({
  /** The day of the cleaning, `yyyy-mm-dd`, in Tashkent. */
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  screenshots: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  practiceFiles: z.number().int().nonnegative(),
});
export type RetentionPreview = z.infer<typeof RetentionPreviewSchema>;

export const SchoolSettingsResponseSchema = z.strictObject({
  settings: SchoolSettingsSchema,
  /** Absent on a school computer: it cleans by the same rules, the website shows them. */
  retention: RetentionPreviewSchema.optional(),
});
export type SchoolSettingsResponse = z.infer<typeof SchoolSettingsResponseSchema>;

// ---------- invitations by link (PLAN.md 2.3; A6)

export const SchoolInviteSchema = z.strictObject({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  createdByName: z.string().min(1),
  /** How many teachers came in by it. */
  used: z.number().int().nonnegative(),
});
export type SchoolInvite = z.infer<typeof SchoolInviteSchema>;

export const SchoolInvitesResponseSchema = z.strictObject({ invites: z.array(SchoolInviteSchema) });
export type SchoolInvitesResponse = z.infer<typeof SchoolInvitesResponseSchema>;

/** The secret is shown once, when the link is made; the platform keeps only its hash. */
export const CreatedInviteResponseSchema = z.strictObject({
  invite: SchoolInviteSchema,
  token: z.string().min(1),
});
export type CreatedInviteResponse = z.infer<typeof CreatedInviteResponseSchema>;

/** What the link says to whoever opens it, signed in or not. */
export const InviteInfoResponseSchema = z.strictObject({
  school: z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    city: z.string().min(1).nullable(),
  }),
  expiresAt: z.string().min(1),
  /** Who opens it: `guest` — not signed in, `member` — already a teacher of the school. */
  visitor: z.enum(['guest', 'teacher', 'member']),
});
export type InviteInfoResponse = z.infer<typeof InviteInfoResponseSchema>;

export const InviteAcceptResponseSchema = z.strictObject({
  schoolId: z.string().min(1),
  /** Was a teacher of the school before the link. */
  already: z.boolean(),
});
export type InviteAcceptResponse = z.infer<typeof InviteAcceptResponseSchema>;

export const INVITE_DAYS = 7;
