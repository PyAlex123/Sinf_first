import { afterEach, describe, expect, it } from 'vitest';
import { SeatPlanSchema } from '@sinf/shared';
import { buildApp } from '../src/app.js';
import { schema } from '../src/db/index.js';
import { rememberSeat, RoomComputers } from '../src/services/seats.js';
import { loginTeacher, testConfig, testContent, testDatabase } from './helpers.js';

/** Stage 3, H8: the teacher corrects the seating of a class on the classroom's teacher computer. */

type App = Awaited<ReturnType<typeof buildApp>>;
const opened: { app: App; close: () => void }[] = [];

afterEach(async () => {
  for (const { app, close } of opened.splice(0)) {
    await app.close();
    close();
  }
});

async function server(classroom = true) {
  const database = testDatabase();
  const config = testConfig({ CLASSROOM_MODE: classroom ? '1' : '0' });
  const app = await buildApp({ config, db: database.db, content: testContent() });
  await app.ready();
  opened.push({ app, close: () => database.close() });
  const cookie = await loginTeacher(app);
  return { app, db: database.db, cookie };
}

const plan = (body: unknown) =>
  Object.fromEntries(SeatPlanSchema.parse(body).seats.map((s) => [s.pc, s.studentId]));

describe('seating', () => {
  it('lists the room in room order and moves, swaps and frees seats', async () => {
    const { app, db, cookie } = await server();
    rememberSeat(db, 'class-1a', 'ПК-12', 'student-01');
    rememberSeat(db, 'class-1a', 'ПК-5', 'student-02');
    const get = () =>
      app.inject({ method: 'GET', url: '/api/classes/class-1a/seats', headers: { cookie } });
    const put = (pc: string, studentId: string | null) =>
      app.inject({
        method: 'PUT',
        url: '/api/classes/class-1a/seats',
        headers: { cookie },
        payload: { pc, studentId },
      });

    const first = await get();
    expect(first.statusCode).toBe(200);
    expect(SeatPlanSchema.parse(first.json()).seats.map((s) => s.pc)).toEqual(['ПК-5', 'ПК-12']);

    // Drag student-01 onto student-02: they swap.
    expect(plan((await put('ПК-5', 'student-01')).json())).toEqual({
      'ПК-5': 'student-01',
      'ПК-12': 'student-02',
    });
    // A child without a seat onto a taken computer: the one there is left without a seat.
    expect(plan((await put('ПК-12', 'student-03')).json())).toEqual({
      'ПК-5': 'student-01',
      'ПК-12': 'student-03',
    });
    expect(
      db
        .select()
        .from(schema.seats)
        .all()
        .some((s) => s.studentId === 'student-02'),
    ).toBe(false);
    // Moving to the same computer changes nothing; freeing drops the row.
    expect(plan((await put('ПК-5', 'student-01')).json())['ПК-5']).toBe('student-01');
    const freed = plan((await put('ПК-5', null)).json());
    expect(freed).toEqual({ 'ПК-12': 'student-03' });
    // The login keeps one seat per child as well.
    rememberSeat(db, 'class-1a', 'ПК-7', 'student-03');
    expect(plan((await get()).json())).toEqual({ 'ПК-7': 'student-03' });
  });

  it('keeps every computer that asked for a lesson, seated or not', async () => {
    const { app, db, cookie } = await server();
    rememberSeat(db, 'class-1a', 'ПК-3', 'student-01');
    await app.inject({ method: 'GET', url: '/api/join/room?pc=%D0%9F%D0%9A-9' });
    await app.inject({ method: 'GET', url: '/api/join/room?pc=%D0%9F%D0%9A-9' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/classes/class-1a/seats',
      headers: { cookie },
    });
    expect(SeatPlanSchema.parse(res.json()).seats).toEqual([
      { pc: 'ПК-3', studentId: 'student-01' },
      { pc: 'ПК-9', studentId: null },
    ]);
    expect(db.select().from(schema.roomComputers).all()).toHaveLength(1);
  });

  it('refuses a child of another class, a stranger and the platform', async () => {
    const { app, db, cookie } = await server();
    const created = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: { cookie },
      payload: { name: '2Б', grade: 2 },
    });
    const otherClass = created.json<{ class: { id: string } }>().class.id;
    await app.inject({
      method: 'POST',
      url: `/api/classes/${otherClass}/students`,
      headers: { cookie },
      payload: { students: [{ lastName: 'Чужой', firstName: 'Ученик' }] },
    });
    const other = db
      .select()
      .from(schema.students)
      .all()
      .find((s) => s.classId === otherClass);
    expect(other).toBeDefined();
    const stranger = await app.inject({
      method: 'PUT',
      url: '/api/classes/class-1a/seats',
      headers: { cookie },
      payload: { pc: 'ПК-1', studentId: other?.id },
    });
    expect(stranger.statusCode).toBe(400);
    const nobody = await app.inject({
      method: 'PUT',
      url: '/api/classes/class-1a/seats',
      headers: { cookie },
      payload: { pc: 'ПК-1', studentId: 'no-such-student' },
    });
    expect(nobody.statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/classes/class-1a/seats' })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/classes/no-such-class/seats',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);

    const platform = await server(false);
    const res = await platform.app.inject({
      method: 'GET',
      url: '/api/classes/class-1a/seats',
      headers: { cookie: platform.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('RoomComputers', () => {
  it('writes a polling computer at most once a minute', () => {
    const database = testDatabase();
    let now = 1_000_000;
    const computers = new RoomComputers(database.db, () => now);
    const at = () => database.db.select().from(schema.roomComputers).all()[0]?.lastSeenAt;
    computers.seen('ПК-1');
    const first = at();
    now += 30_000;
    computers.seen('ПК-1');
    expect(at()).toBe(first);
    now += 31_000;
    computers.seen('ПК-1');
    expect(at()).not.toBe(first);
    database.close();
  });
});
