import { z } from 'zod';
import { LocaleSchema } from './locale.js';

/**
 * The site's front door (PLAN.md 8.4; stage 6, B10; ADR-026). The platform shows the landing page
 * and takes requests for a pilot; a classroom server (the teacher's computer) keeps the plain page
 * with big buttons, because children in the room have no use for an advertisement.
 */

export const SiteInfoSchema = z.strictObject({
  kind: z.enum(['platform', 'classroom']),
});
export type SiteInfo = z.infer<typeof SiteInfoSchema>;

const line = (max: number) => z.string().trim().min(1).max(max);

/** What a school leaves in the pilot form. `website` is a trap: people never see it, robots fill it. */
export const PilotRequestInputSchema = z.strictObject({
  school: line(160),
  city: line(80),
  name: line(120),
  /** A phone, a Telegram name or an e-mail: whatever the school wants to be called on. */
  contact: line(120),
  classes: z.number().int().min(1).max(200).nullable().default(null),
  comment: z.string().trim().max(1000).default(''),
  locale: LocaleSchema.default('ru'),
  website: z.string().max(200).default(''),
});
export type PilotRequestInput = z.infer<typeof PilotRequestInputSchema>;

export const PilotRequestSchema = z.strictObject({
  id: z.string(),
  school: z.string(),
  city: z.string(),
  name: z.string(),
  contact: z.string(),
  classes: z.number().int().nullable(),
  comment: z.string(),
  locale: LocaleSchema,
  createdAt: z.string(),
  handledAt: z.string().nullable(),
});
export type PilotRequest = z.infer<typeof PilotRequestSchema>;

export const PilotRequestListResponseSchema = z.strictObject({
  requests: z.array(PilotRequestSchema),
});
export type PilotRequestListResponse = z.infer<typeof PilotRequestListResponseSchema>;
