import type { FastifyPluginCallback } from 'fastify';
import {
  LessonSyncBundleSchema,
  type LessonSyncResponse,
  type SchoolSnapshot,
  type SyncStatus,
} from '@sinf/shared';
import { requireDevice } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { notFound } from '../errors.js';
import { buildSchoolSnapshot } from '../sync/snapshot.js';
import { receiveLessonBundle } from '../sync/receive.js';
import type { SyncWorker } from '../sync/worker.js';

/**
 * The two sides of S2.6 in one file, because they are two halves of one conversation (ADR-011):
 *
 * — the platform answers a paired school computer: here is your school's roster, and yes, I have
 *   this lesson;
 * — the school computer answers its own teacher: everything is sent, or N lessons are waiting.
 *
 * Both platform routes go through `requireDevice`, the way the lesson material does (S2.5).
 */
export const syncRoutes: FastifyPluginCallback<{ worker: SyncWorker | null }> = (
  app,
  opts,
  done,
) => {
  const { db } = app.ctx;
  const { worker } = opts;

  app.get('/sync/snapshot', async (request): Promise<SchoolSnapshot> => {
    const device = await requireDevice(db, request.headers.authorization);
    const snapshot = buildSchoolSnapshot(db, device.schoolId);
    if (!snapshot) throw notFound('School');
    return snapshot;
  });

  app.post('/sync/lesson', async (request): Promise<LessonSyncResponse> => {
    const device = await requireDevice(db, request.headers.authorization);
    const bundle = LessonSyncBundleSchema.parse(request.body);
    return receiveLessonBundle(db, device, bundle);
  });

  /** What the teacher sees on a school computer; on the platform it simply says so. */
  app.get('/sync/status', { preHandler: requireTeacher }, (): SyncStatus => {
    return (
      worker?.status() ?? {
        mode: 'platform',
        pending: 0,
        lastSyncAt: null,
        lastError: null,
        rosterAt: null,
      }
    );
  });

  /** "Send now": the teacher saw that something is waiting and has just plugged the cable back in. */
  app.post('/sync/now', { preHandler: requireTeacher }, async (): Promise<SyncStatus> => {
    if (worker) await worker.syncNow();
    return (
      worker?.status() ?? {
        mode: 'platform',
        pending: 0,
        lastSyncAt: null,
        lastError: null,
        rosterAt: null,
      }
    );
  });

  done();
};
