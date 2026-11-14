import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateDeviceSchema,
  DeviceHeartbeatSchema,
  PairDeviceSchema,
  UpdateDeviceSchema,
  type Device,
  type DeviceListResponse,
  type DeviceStateResponse,
  type PairDeviceResponse,
  type Teacher,
} from '@sinf/shared';
import { requireSchoolAdmin, requireSchoolMember } from '../auth/access.js';
import { hashSecret, verifySecret } from '../auth/password.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import { AttemptGuard } from '../services/attempt-guard.js';

const Params = z.object({ id: z.string().min(1) });

/** Letters and digits that cannot be confused when read off a screen and typed on another computer. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;

type DeviceRow = typeof schema.devices.$inferSelect;

function newPairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * School computers (S2.4, PLAN.md 6.2). The administrator adds a machine in the school cabinet and gets
 * a pairing code; our Windows app trades that code for its own token and reports in with it. One code
 * belongs to one computer and is cleared the moment it is used.
 */
export const deviceRoutes: FastifyPluginCallback<{ pairGuard?: AttemptGuard }> = (
  app,
  opts,
  done,
) => {
  const { db } = app.ctx;
  // A six-character code is short on purpose: this slows down guessing it from outside.
  const guard = opts.pairGuard ?? new AttemptGuard(10, 10 * 60 * 1000);

  const toDevice = (row: DeviceRow, withCode: boolean): Device => ({
    id: row.id,
    name: row.name,
    room: row.room,
    role: row.role,
    pairingCode: withCode ? row.pairingCode : null,
    pairingExpiresAt: withCode ? row.pairingExpiresAt : null,
    paired: row.tokenHash !== null,
    appVersion: row.appVersion,
    lastSeenAt: row.lastSeenAt,
  });

  const listOf = (schoolId: string, withCodes: boolean): DeviceListResponse => ({
    devices: db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.schoolId, schoolId))
      .orderBy(schema.devices.room, schema.devices.name)
      .all()
      .map((row) => toDevice(row, withCodes)),
  });

  /** The device row behind `Authorization: Device <deviceId>.<token>`, or 401. */
  async function deviceOf(request: FastifyRequest): Promise<DeviceRow> {
    const header = request.headers.authorization ?? '';
    const raw = header.startsWith('Device ') ? header.slice('Device '.length).trim() : '';
    const dot = raw.indexOf('.');
    const deviceId = dot > 0 ? raw.slice(0, dot) : '';
    const token = dot > 0 ? raw.slice(dot + 1) : '';
    const row = deviceId
      ? db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()
      : undefined;
    const ok = row?.tokenHash ? await verifySecret(token, row.tokenHash) : false;
    if (!row || !ok) {
      throw new ApiHttpError(401, 'unauthorized', 'Pair this computer with a school first');
    }
    return row;
  }

  const stateOf = (row: DeviceRow, now: string): DeviceStateResponse => {
    const school = db
      .select()
      .from(schema.schools)
      .where(eq(schema.schools.id, row.schoolId))
      .get();
    return {
      deviceId: row.id,
      name: row.name,
      room: row.room,
      role: row.role,
      school: { id: row.schoolId, name: school?.name ?? '' },
      serverNow: now,
    };
  };

  // ---------- school cabinet

  app.get('/schools/:id/devices', { preHandler: requireTeacher }, (request): DeviceListResponse => {
    const { id } = Params.parse(request.params);
    // A plain teacher sees the machines but not the codes that would let them pair one.
    const { role } = requireSchoolMember(db, request.teacher as Teacher, id);
    return listOf(id, role === 'admin');
  });

  app.post(
    '/schools/:id/devices',
    { preHandler: requireTeacher },
    (request): { device: Device } => {
      const { id } = Params.parse(request.params);
      const body = CreateDeviceSchema.parse(request.body);
      requireSchoolAdmin(db, request.teacher as Teacher, id);
      const now = Date.now();
      const row = {
        id: randomUUID(),
        schoolId: id,
        name: body.name,
        room: body.room?.trim() || null,
        role: body.role,
        pairingCode: newPairingCode(),
        pairingExpiresAt: new Date(now + CODE_LIFETIME_MS).toISOString(),
        tokenHash: null,
        appVersion: null,
        platform: null,
        lastSeenAt: null,
        createdAt: new Date(now).toISOString(),
      };
      db.insert(schema.devices).values(row).run();
      request.log.info({ schoolId: id, deviceId: row.id }, 'device slot created');
      return { device: toDevice(row, true) };
    },
  );

  app.patch('/devices/:id', { preHandler: requireTeacher }, (request): { device: Device } => {
    const { id } = Params.parse(request.params);
    const body = UpdateDeviceSchema.parse(request.body);
    const row = db.select().from(schema.devices).where(eq(schema.devices.id, id)).get();
    if (!row) throw notFound('Computer');
    requireSchoolAdmin(db, request.teacher as Teacher, row.schoolId);
    db.update(schema.devices)
      .set({
        name: body.name ?? row.name,
        room: body.room === undefined ? row.room : body.room?.trim() || null,
        role: body.role ?? row.role,
      })
      .where(eq(schema.devices.id, id))
      .run();
    const updated = db.select().from(schema.devices).where(eq(schema.devices.id, id)).get();
    return { device: toDevice(updated as DeviceRow, true) };
  });

  /** Unpairs and forgets the machine: its token stops working at once. */
  app.delete('/devices/:id', { preHandler: requireTeacher }, (request): DeviceListResponse => {
    const { id } = Params.parse(request.params);
    const row = db.select().from(schema.devices).where(eq(schema.devices.id, id)).get();
    if (!row) throw notFound('Computer');
    requireSchoolAdmin(db, request.teacher as Teacher, row.schoolId);
    db.delete(schema.devices).where(eq(schema.devices.id, id)).run();
    request.log.info({ deviceId: id }, 'device removed');
    return listOf(row.schoolId, true);
  });

  /** A fresh code for a machine that never paired, or one whose code has expired. */
  app.post('/devices/:id/code', { preHandler: requireTeacher }, (request): { device: Device } => {
    const { id } = Params.parse(request.params);
    const row = db.select().from(schema.devices).where(eq(schema.devices.id, id)).get();
    if (!row) throw notFound('Computer');
    requireSchoolAdmin(db, request.teacher as Teacher, row.schoolId);
    const code = newPairingCode();
    db.update(schema.devices)
      .set({
        pairingCode: code,
        pairingExpiresAt: new Date(Date.now() + CODE_LIFETIME_MS).toISOString(),
        // A new code unpairs the machine: the old token must not keep working behind the school's back.
        tokenHash: null,
      })
      .where(eq(schema.devices.id, id))
      .run();
    const updated = db.select().from(schema.devices).where(eq(schema.devices.id, id)).get();
    return { device: toDevice(updated as DeviceRow, true) };
  });

  // ---------- the app on the school computer

  app.post('/devices/pair', async (request): Promise<PairDeviceResponse> => {
    const body = PairDeviceSchema.parse(request.body);
    const key = request.ip;
    const now = Date.now();
    const status = guard.status(key, now);
    if (status.locked) {
      throw new ApiHttpError(429, 'too_many_attempts', 'Too many attempts, try again later', {
        retryAfterSec: status.retryAfterSec,
      });
    }
    const code = body.code.trim().toUpperCase();
    const row = db.select().from(schema.devices).where(eq(schema.devices.pairingCode, code)).get();
    const expired = row?.pairingExpiresAt ? Date.parse(row.pairingExpiresAt) < now : true;
    if (!row || expired) {
      guard.fail(key, now);
      throw new ApiHttpError(404, 'bad_code', 'This code does not work; ask for a new one');
    }
    guard.reset(key);
    const token = randomBytes(32).toString('hex');
    db.update(schema.devices)
      .set({
        tokenHash: await hashSecret(token),
        // The code is good for one computer only.
        pairingCode: null,
        pairingExpiresAt: null,
        appVersion: body.appVersion ?? null,
        platform: body.platform ?? null,
        lastSeenAt: new Date(now).toISOString(),
      })
      .where(eq(schema.devices.id, row.id))
      .run();
    const school = db
      .select()
      .from(schema.schools)
      .where(eq(schema.schools.id, row.schoolId))
      .get();
    request.log.info({ deviceId: row.id, schoolId: row.schoolId }, 'device paired');
    return {
      deviceId: row.id,
      deviceToken: `${row.id}.${token}`,
      name: row.name,
      room: row.room,
      role: row.role,
      school: { id: row.schoolId, name: school?.name ?? '' },
    };
  });

  /** The app says it is alive; the school sees when each machine was last on. */
  app.post('/devices/heartbeat', async (request): Promise<DeviceStateResponse> => {
    const body = DeviceHeartbeatSchema.parse(request.body ?? {});
    const row = await deviceOf(request);
    const now = new Date().toISOString();
    db.update(schema.devices)
      .set({ lastSeenAt: now, appVersion: body.appVersion ?? row.appVersion })
      .where(eq(schema.devices.id, row.id))
      .run();
    return stateOf(row, now);
  });

  done();
};
