import { and, eq } from 'drizzle-orm';
import { comparePcNames, type SeatPlan } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';

/**
 * Seating on the teacher's computer (stage 3, H2 and H8; ADR-014). A row says "this child of this
 * class sat at this computer last time". A child sits in one place per class, a computer holds one
 * child per class.
 */

/**
 * The child sits here now (a login, H2). Their old seat in this class is given up, so next lesson
 * that computer asks "who are you?" instead of showing the wrong name.
 */
export function rememberSeat(db: Db, classId: string, pc: string, studentId: string): void {
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.delete(schema.seats)
      .where(and(eq(schema.seats.classId, classId), eq(schema.seats.studentId, studentId)))
      .run();
    tx.insert(schema.seats)
      .values({ classId, pc, studentId, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [schema.seats.classId, schema.seats.pc],
        set: { studentId, lastUsedAt: now },
      })
      .run();
  });
}

/**
 * The teacher corrects the seating (H8). The child goes to `pc`; whoever of this class sat there
 * takes the child's old computer — dragging one name onto another swaps them — or, when the child
 * had no seat, is left without one. `studentId` null frees the computer.
 */
export function moveSeat(db: Db, classId: string, pc: string, studentId: string | null): void {
  const now = new Date().toISOString();
  const inClass = eq(schema.seats.classId, classId);
  db.transaction((tx) => {
    const occupant = tx
      .select()
      .from(schema.seats)
      .where(and(inClass, eq(schema.seats.pc, pc)))
      .get();
    if (studentId === null) {
      if (occupant)
        tx.delete(schema.seats)
          .where(and(inClass, eq(schema.seats.pc, pc)))
          .run();
      return;
    }
    if (occupant?.studentId === studentId) return;
    const old = tx
      .select()
      .from(schema.seats)
      .where(and(inClass, eq(schema.seats.studentId, studentId)))
      .get();
    if (old)
      tx.delete(schema.seats)
        .where(and(inClass, eq(schema.seats.pc, old.pc)))
        .run();
    if (occupant) {
      tx.delete(schema.seats)
        .where(and(inClass, eq(schema.seats.pc, pc)))
        .run();
      if (old) {
        tx.insert(schema.seats)
          .values({ classId, pc: old.pc, studentId: occupant.studentId, lastUsedAt: now })
          .run();
      }
    }
    tx.insert(schema.seats).values({ classId, pc, studentId, lastUsedAt: now }).run();
  });
}

/** A computer asks for the lesson every three seconds; its "still here" is written once a minute. */
const SEEN_WRITE_INTERVAL_MS = 60_000;

/**
 * Remembers the room's computers as they ask for the lesson or log a child in (H8), so the seating
 * editor knows them all. Writes at most once a minute per computer: thirty computers polling must not
 * keep the teacher's disk busy.
 */
export class RoomComputers {
  private readonly written = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  seen(pc: string): void {
    const now = this.now();
    if (now - (this.written.get(pc) ?? -Infinity) < SEEN_WRITE_INTERVAL_MS) return;
    this.written.set(pc, now);
    const at = new Date(now).toISOString();
    this.db
      .insert(schema.roomComputers)
      .values({ pc, lastSeenAt: at })
      .onConflictDoUpdate({ target: schema.roomComputers.pc, set: { lastSeenAt: at } })
      .run();
  }
}

/**
 * The room's computers as this teacher's computer knows them — every computer that asked for a
 * lesson here, and any name a class has sat at (one teacher's computer serves one room) — in room
 * order, each with this class's child or nobody.
 */
export function seatPlan(db: Db, classId: string): SeatPlan {
  const rows = db
    .select({
      classId: schema.seats.classId,
      pc: schema.seats.pc,
      studentId: schema.seats.studentId,
    })
    .from(schema.seats)
    .all();
  const known = db.select({ pc: schema.roomComputers.pc }).from(schema.roomComputers).all();
  const pcs = [...new Set([...known.map((r) => r.pc), ...rows.map((r) => r.pc)])].sort(
    comparePcNames,
  );
  return {
    seats: pcs.map((pc) => ({
      pc,
      studentId: rows.find((r) => r.classId === classId && r.pc === pc)?.studentId ?? null,
    })),
  };
}
