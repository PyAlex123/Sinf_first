import { z } from 'zod';
import { LessonVisibilitySchema } from './authored.js';

/**
 * A programme (PLAN.md 3.8; stage 4, W7): a sequence of lessons for a class, by quarters — the
 * author's and the teacher's own alike. Assigned to a class, it says which lesson comes next.
 */

export const ProgramIdSchema = z.string().regex(/^p-[0-9a-f]{32}$/);
const lessonId = z.string().regex(/^[a-z0-9-]+$/);

export const ProgramItemSchema = z.strictObject({
  lessonId,
  quarter: z.number().int().min(1).max(4),
});
export type ProgramItem = z.infer<typeof ProgramItemSchema>;

/** A school year has about 34 weeks; two lessons a week is the most a programme holds. */
export const MAX_PROGRAM_ITEMS = 140;

export const ProgramSummarySchema = z.strictObject({
  id: ProgramIdSchema,
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  title: z.string().min(1),
  grade: z.number().int().min(1).max(11),
  visibility: LessonVisibilitySchema,
  lessons: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  updatedAt: z.string().min(1),
  editable: z.boolean(),
});
export type ProgramSummary = z.infer<typeof ProgramSummarySchema>;

/** An item as the page shows it: the lesson's title found by the server. */
export const ProgramLessonSchema = ProgramItemSchema.extend({
  title: z.string().min(1),
  /** The lesson is gone (deleted, or a teacher's lesson not shared any more). */
  missing: z.boolean(),
});
export type ProgramLesson = z.infer<typeof ProgramLessonSchema>;

export const ProgramSchema = ProgramSummarySchema.extend({
  items: z.array(ProgramLessonSchema),
});
export type Program = z.infer<typeof ProgramSchema>;

export const ProgramListResponseSchema = z.strictObject({
  programs: z.array(ProgramSummarySchema),
});
export type ProgramListResponse = z.infer<typeof ProgramListResponseSchema>;

export const CreateProgramSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  grade: z.number().int().min(1).max(11),
});
export type CreateProgram = z.infer<typeof CreateProgramSchema>;

export const UpdateProgramSchema = CreateProgramSchema.extend({
  visibility: LessonVisibilitySchema,
  items: z.array(ProgramItemSchema).max(MAX_PROGRAM_ITEMS),
  version: z.number().int().positive(),
});
export type UpdateProgram = z.infer<typeof UpdateProgramSchema>;

export const SetClassProgramSchema = z.strictObject({ programId: ProgramIdSchema.nullable() });
export type SetClassProgram = z.infer<typeof SetClassProgramSchema>;

/** A class's programme and where the class is in it. */
export const ClassProgramSchema = z.strictObject({
  program: ProgramSummarySchema.nullable(),
  items: z.array(ProgramLessonSchema.extend({ done: z.boolean() })),
  /** The first lesson of the programme the class has not had yet; null when all are done. */
  next: ProgramLessonSchema.nullable(),
});
export type ClassProgram = z.infer<typeof ClassProgramSchema>;

/** A programme as the school computer keeps it (ADR-011): the class's lesson order. */
export const SyncProgramSchema = z.strictObject({
  id: ProgramIdSchema,
  ownerId: z.string().min(1),
  title: z.string().min(1),
  grade: z.number().int(),
  items: z.array(ProgramItemSchema),
  version: z.number().int().positive(),
  updatedAt: z.string().min(1),
});
export type SyncProgram = z.infer<typeof SyncProgramSchema>;

/**
 * The first lesson of the programme not held with the class yet, in programme order. A lesson held
 * twice counts once; one held out of order still counts as had.
 */
export function nextOfProgram<T extends { lessonId: string; missing?: boolean }>(
  items: readonly T[],
  held: ReadonlySet<string>,
): T | null {
  return items.find((item) => !item.missing && !held.has(item.lessonId)) ?? null;
}
