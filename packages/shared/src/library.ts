import { z } from 'zod';

/**
 * The library (PLAN.md 3.9; stage 4, W8): lessons and programmes their authors made public
 * ("в библиотеке"), found by grade and words, copied for oneself, reported, moderated by the
 * superadmin.
 */

export const LibraryKindSchema = z.enum(['lesson', 'program']);
export type LibraryKind = z.infer<typeof LibraryKindSchema>;

export const LibraryQuerySchema = z.object({
  kind: LibraryKindSchema.default('lesson'),
  grade: z.coerce.number().int().min(1).max(11).optional(),
  q: z.string().trim().max(100).optional(),
});
export type LibraryQuery = z.infer<typeof LibraryQuerySchema>;

export const LibraryItemSchema = z.strictObject({
  kind: LibraryKindSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  topic: z.string(),
  grade: z.number().int(),
  ownerName: z.string().min(1),
  /** Lessons: minutes; programmes: number of lessons. */
  size: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
  /** Copies other teachers made of it: a hint of what is worth taking. */
  copies: z.number().int().nonnegative(),
  mine: z.boolean(),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

export const LibraryResponseSchema = z.strictObject({ items: z.array(LibraryItemSchema) });
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;

export const ReportSchema = z.strictObject({
  kind: LibraryKindSchema,
  id: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});
export type Report = z.infer<typeof ReportSchema>;

export const LibraryReportSchema = z.strictObject({
  id: z.string().min(1),
  kind: LibraryKindSchema,
  itemId: z.string().min(1),
  itemTitle: z.string(),
  ownerName: z.string(),
  reporterName: z.string(),
  reason: z.string(),
  createdAt: z.string().min(1),
  /** The item is hidden from the library now. */
  hidden: z.boolean(),
});
export type LibraryReport = z.infer<typeof LibraryReportSchema>;

export const LibraryReportsResponseSchema = z.strictObject({
  reports: z.array(LibraryReportSchema),
});
export type LibraryReportsResponse = z.infer<typeof LibraryReportsResponseSchema>;

/** The superadmin hides an item (or shows it again), and closes the reports about it. */
export const ModerateSchema = z.strictObject({ hidden: z.boolean() });
export type Moderate = z.infer<typeof ModerateSchema>;
