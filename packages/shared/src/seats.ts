import { z } from 'zod';
import { PcNameSchema } from './api.js';

/**
 * Seating on the teacher's computer (CLAUDE.md §4.1, stage 3 H2 and H8): who of a class sits at which
 * classroom computer, so the next lesson shows their name straight away. The teacher corrects it on
 * the class page; a child's own login corrects it too.
 */

const id = z.string().min(1);

/** "ПК-5" < "ПК-05" < "ПК-12": computers the way a room numbers them, not the way strings sort. */
export function comparePcNames(a: string, b: string): number {
  return (
    a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }) ||
    // Same number written differently: the shorter spelling first, then any stable order.
    a.length - b.length ||
    (a < b ? -1 : a > b ? 1 : 0)
  );
}

export const SeatSchema = z.strictObject({
  pc: PcNameSchema,
  /** Who of this class sat here last; null when nobody of this class did. */
  studentId: id.nullable(),
});
export type Seat = z.infer<typeof SeatSchema>;

/** Every computer of the room the teacher's computer knows, in room order, with this class's child. */
export const SeatPlanSchema = z.strictObject({ seats: z.array(SeatSchema) });
export type SeatPlan = z.infer<typeof SeatPlanSchema>;

/**
 * Put a child at a computer (or free it with null). Whoever sat there moves to the child's old
 * computer: dragging one name onto another swaps them.
 */
export const SeatUpdateSchema = z.strictObject({ pc: PcNameSchema, studentId: id.nullable() });
export type SeatUpdate = z.infer<typeof SeatUpdateSchema>;
