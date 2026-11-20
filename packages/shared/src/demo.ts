import { z } from 'zod';
import { SessionSummarySchema } from './api.js';

/**
 * The demo (STAGE1 §5, S1.15): one fictional class of one demo teacher. Virtual students live only
 * here — a real class must never get invented children in its journal, and a school computer must
 * never send them to the platform (ADR-013).
 */

export const DEMO_TEACHER_ID = 'user-demo-teacher';
export const DEMO_CLASS_ID = 'class-1a';

/** How many virtual students one demo lesson can have: a whole first grade. */
export const MAX_VIRTUAL_STUDENTS = 20;

export const AddVirtualSchema = z.strictObject({
  sessionId: z.string().min(1),
  count: z.number().int().min(1).max(MAX_VIRTUAL_STUDENTS),
});
export type AddVirtual = z.infer<typeof AddVirtualSchema>;

/** What the demo page needs: the running demo lesson, if any, and how many play in it. */
export const DemoStatusSchema = z.strictObject({
  classId: z.string().min(1),
  session: SessionSummarySchema.nullable(),
  virtualInSession: z.number().int().nonnegative(),
  virtualMax: z.number().int().positive(),
});
export type DemoStatus = z.infer<typeof DemoStatusSchema>;
