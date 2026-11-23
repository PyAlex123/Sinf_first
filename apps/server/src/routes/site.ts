import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  PilotRequestInputSchema,
  type PilotRequest,
  type PilotRequestListResponse,
  type SiteInfo,
  type Teacher,
} from '@sinf/shared';
import { requireSuperadmin } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import { AttemptGuard } from '../services/attempt-guard.js';

const IdParams = z.object({ id: z.string().min(1).max(64) });

/**
 * The site's front door (PLAN.md 8.4; stage 6, B10; ADR-026): what kind of server this is, so the
 * web client shows the landing page only on the platform, and the pilot requests from that page.
 */
export const siteRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, config } = app.ctx;
  /** A classroom server: the teacher's computer, by its mode or by its link to the platform. */
  const classroom = (): boolean => config.classroom || app.sync?.link() != null;
  /** Three requests an hour from one address: enough for a school, too few for a flood. */
  const requests = new AttemptGuard(3, 60 * 60 * 1000);

  const toRequest = (row: typeof schema.pilotRequests.$inferSelect): PilotRequest => ({
    id: row.id,
    school: row.school,
    city: row.city,
    name: row.name,
    contact: row.contact,
    classes: row.classes,
    comment: row.comment,
    locale: row.locale,
    createdAt: row.createdAt,
    handledAt: row.handledAt,
  });

  app.get('/site', (): SiteInfo => ({ kind: classroom() ? 'classroom' : 'platform' }));

  app.post('/pilot-requests', async (request, reply): Promise<{ ok: true }> => {
    if (classroom()) throw notFound('Page');
    const body = PilotRequestInputSchema.parse(request.body);
    // A robot that filled the hidden field is told "thank you" and nothing is kept.
    if (body.website.trim()) return reply.status(201).send({ ok: true });
    const key = `pilot:${request.ip}`;
    const now = Date.now();
    const status = requests.status(key, now);
    if (status.locked) {
      throw new ApiHttpError(429, 'too_many_requests', 'Too many requests, try again later', {
        retryAfterSec: status.retryAfterSec,
      });
    }
    requests.fail(key, now);
    const row = {
      id: randomUUID(),
      school: body.school,
      city: body.city,
      name: body.name,
      contact: body.contact,
      classes: body.classes,
      comment: body.comment,
      locale: body.locale,
      createdAt: new Date().toISOString(),
      handledAt: null,
    };
    db.insert(schema.pilotRequests).values(row).run();
    request.log.info({ requestId: row.id }, 'pilot request received');
    // A letter to us when the site has mail; without SMTP it goes to the log (ADR-021).
    if (config.superadmin) {
      try {
        await app.mailer.send({
          to: config.superadmin.email,
          subject: `Sinf: заявка на пилот — ${row.school}`,
          text: [
            `Школа: ${row.school}`,
            `Город: ${row.city}`,
            `Кто: ${row.name}`,
            `Связаться: ${row.contact}`,
            `Классов: ${row.classes ?? '—'}`,
            `Комментарий: ${row.comment || '—'}`,
            '',
            'Все заявки — /admin.',
          ].join('\n'),
        });
      } catch (error) {
        request.log.error({ err: error }, 'pilot request letter failed');
      }
    }
    return reply.status(201).send({ ok: true });
  });

  app.get(
    '/admin/pilot-requests',
    { preHandler: requireTeacher },
    (request): PilotRequestListResponse => {
      requireSuperadmin(db, request.teacher as Teacher);
      const rows = db
        .select()
        .from(schema.pilotRequests)
        .orderBy(desc(schema.pilotRequests.createdAt))
        .limit(200)
        .all();
      // New ones first, then the handled ones.
      const list = rows.map(toRequest);
      return {
        requests: [...list.filter((r) => !r.handledAt), ...list.filter((r) => r.handledAt)],
      };
    },
  );

  app.post(
    '/admin/pilot-requests/:id/handled',
    { preHandler: requireTeacher },
    (request): { ok: true } => {
      requireSuperadmin(db, request.teacher as Teacher);
      const { id } = IdParams.parse(request.params);
      const row = db
        .select()
        .from(schema.pilotRequests)
        .where(eq(schema.pilotRequests.id, id))
        .get();
      if (!row) throw notFound('Request');
      db.update(schema.pilotRequests)
        .set({ handledAt: row.handledAt ? null : new Date().toISOString() })
        .where(eq(schema.pilotRequests.id, id))
        .run();
      return { ok: true };
    },
  );

  done();
};
