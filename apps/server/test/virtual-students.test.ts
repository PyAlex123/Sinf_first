import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Participant, type SessionState } from '@sinf/shared';
import Fastify from 'fastify';
import { schema, type DatabaseHandle } from '../src/db/index.js';
import { ensureVirtualStudents } from '../src/db/seed.js';
import { SessionStore, type RoomSocket } from '../src/realtime/session-store.js';
import { VirtualStudents } from '../src/services/virtual-students.js';
import { testContent, testDatabase } from './helpers.js';

/**
 * S1.15: virtual students play a lesson through the same engine as children do. Time and chance
 * are ours: the clock moves when the test says so, and the dice are seeded.
 */

/** Small seeded generator (mulberry32), so every run plays the same lesson. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const log = Fastify({ logger: false }).log;

/** The teacher's end of the room: commands go in, nothing needs to come back. */
const teacherSocket: RoomSocket = {
  readyState: 1,
  OPEN: 1,
  send: () => undefined,
  close: () => undefined,
  ping: () => undefined,
  terminate: () => undefined,
};

let database: DatabaseHandle;
let now: number;
let store: SessionStore;
let virtual: VirtualStudents;

beforeEach(() => {
  database = testDatabase();
  now = Date.parse('2026-11-20T05:00:00.000Z');
  store = new SessionStore(database.db, testContent(), log, () => now);
  virtual = new VirtualStudents(store, testContent(), log, () => now, seeded(42));
});

afterEach(() => {
  virtual.close();
  // Ending the lessons stops the engine's own timers before the database goes away.
  for (const id of store.liveSessionIds()) store.end(id);
  database.close();
});

function start(lessonId: string, demoSpeed = 1): string {
  const session = store.create({
    classId: 'class-1a',
    lessonId,
    teacherId: 'user-demo-teacher',
    demoSpeed,
  });
  store.attach(session.id, teacherSocket, 'teacher', null);
  return session.id;
}

function teacher(sessionId: string, message: Record<string, unknown> & { type: string }): void {
  store.dispatch(sessionId, teacherSocket, {
    kind: 'command',
    role: 'teacher',
    participantId: null,
    // The engine validates nothing here: the test sends well-formed messages only.
    message: { v: PROTOCOL_VERSION, ...message } as never,
    now,
  });
}

/** Moves the clock in half-second ticks, as the real timer does. */
function play(ms: number): void {
  const until = now + ms;
  while (now < until) {
    now += 500;
    virtual.tick(now);
  }
}

const state = (id: string): SessionState => store.getState(id) as SessionState;
const kids = (id: string): Participant[] => Object.values(state(id).participants);

describe('virtual students', () => {
  it('come in one by one within twenty seconds, marked virtual', () => {
    const id = start('g10');
    virtual.add(id, ensureVirtualStudents(database.db, 10));
    expect(kids(id)).toHaveLength(0);

    play(5_000);
    const early = kids(id).length;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(10);

    play(16_000);
    expect(kids(id)).toHaveLength(10);
    expect(kids(id).every((p) => p.virtual && p.online && p.fullscreen)).toBe(true);
    // They are counted as present, like children who came in.
    const present = database.db
      .select()
      .from(schema.attendance)
      .all()
      .filter((a) => a.sessionId === id && a.status === 'present');
    expect(present).toHaveLength(10);
  });

  it('walk through the stage in free mode and earn different numbers of stars', () => {
    const id = start('g10', 10);
    virtual.add(id, ensureVirtualStudents(database.db, 12));
    play(21_000);
    teacher(id, { type: 'teacher.stage.set', index: 3 }); // practice: the trainers of g10
    teacher(id, { type: 'teacher.mode.set', mode: 'free' });
    play(60_000);

    const stars = kids(id).map((p) => p.stars);
    expect(Math.max(...stars)).toBeGreaterThan(0);
    // Some solve more than others: not everybody ends with the same count.
    expect(new Set(stars).size).toBeGreaterThan(1);
    // Every star went through the engine and into the results table.
    const rows = database.db
      .select()
      .from(schema.screenResults)
      .all()
      .filter((r) => r.sessionId === id);
    expect(rows.reduce((sum, r) => sum + r.stars, 0)).toBe(stars.reduce((a, b) => a + b, 0));
    // They moved on through the screens of the stage.
    expect(kids(id).some((p) => p.screenIndex > 10)).toBe(true);
  });

  it('now and then leave the tab and raise a hand', () => {
    const id = start('g10');
    virtual.add(id, ensureVirtualStudents(database.db, 20));
    play(21_000);
    teacher(id, { type: 'teacher.mode.set', mode: 'free' });
    play(15 * 60_000);

    const events = database.db
      .select()
      .from(schema.activityEvents)
      .all()
      .filter((e) => e.sessionId === id);
    const hidden = events.filter((e) => e.type === 'tab_hidden').length;
    const hands = events.filter((e) => e.type === 'hand_raise').length;
    expect(hidden).toBeGreaterThan(0);
    expect(hands).toBeGreaterThan(0);
    // "Now and then": far from every step.
    expect(hidden).toBeLessThan(20 * 15);
    expect(kids(id).some((p) => p.escapes > 0)).toBe(true);
  });

  it('answer the quiz at their own speed, about seven times out of ten right', () => {
    const id = start('g10');
    virtual.add(id, ensureVirtualStudents(database.db, 20));
    play(21_000);
    teacher(id, { type: 'teacher.stage.set', index: 4 }); // reflection: the quiz starts by itself
    const questions = state(id).quiz?.questionCount ?? 0;
    expect(questions).toBe(6);
    for (let q = 0; q < questions; q++) {
      play(13_000);
      expect(state(id).quiz?.phase).toBe('reveal'); // everybody answered before the time ran out
      teacher(id, { type: 'teacher.quiz.next' }); // leaderboard
      teacher(id, { type: 'teacher.quiz.next' }); // next question
    }
    const answers = database.db
      .select()
      .from(schema.quizAttempts)
      .all()
      .filter((a) => a.sessionId === id);
    expect(answers).toHaveLength(20 * questions);
    const share = answers.filter((a) => a.correct).length / answers.length;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.85);
    // Different speeds: different points for the same right answer.
    const points = new Set(answers.filter((a) => a.correct).map((a) => a.points));
    expect(points.size).toBeGreaterThan(5);
    expect(Math.min(...answers.map((a) => a.timeMs))).toBeGreaterThanOrEqual(2_000);
  });

  it('stand still behind "Attention!" and go when the lesson ends', () => {
    const id = start('g10', 10);
    virtual.add(id, ensureVirtualStudents(database.db, 5));
    play(21_000);
    teacher(id, { type: 'teacher.mode.set', mode: 'free' });
    teacher(id, { type: 'teacher.lock', targets: 'all' });
    const before = JSON.stringify(kids(id).map((p) => [p.screenIndex, p.stars, p.hand]));
    play(60_000);
    expect(JSON.stringify(kids(id).map((p) => [p.screenIndex, p.stars, p.hand]))).toBe(before);

    store.end(id);
    play(1_000);
    expect(virtual.count(id)).toBe(0);
  });

  it('reuse the same twenty rows, lesson after lesson', () => {
    const first = ensureVirtualStudents(database.db, 20);
    const again = ensureVirtualStudents(database.db, 20);
    expect(again.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(first.every((s) => s.isVirtual && s.classId === 'class-1a')).toBe(true);
  });
});
