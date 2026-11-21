import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { ScreenshotUploadSchema, type ScreenshotUploadResponse, type Teacher } from '@sinf/shared';
import { requireSessionClass } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import type { SessionStore } from '../realtime/session-store.js';

const SessionParams = z.object({ id: z.string().min(1) });
const ShotParams = z.object({ id: z.string().uuid() });

/** A JPEG file starts with these three bytes; anything else is not a screenshot. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const MAX_JPEG_BYTES = 420 * 1024;
/** One photograph per child in five seconds is plenty; more is a stuck loop or mischief. */
const MIN_INTERVAL_MS = 5000;

/**
 * Screenshots of classroom computers (stage 3, H5; CLAUDE.md §4.8). The classroom app uploads them to
 * the teacher's computer with the child's lesson token; the teacher sees them in the results gallery.
 * Only on the teacher's computer (`CLASSROOM_MODE`): a browser cannot photograph its screen, and the
 * platform gets them later together with the lesson (ADR-011).
 */
export const screenshotRoutes: FastifyPluginCallback<{ store: SessionStore }> = (
  app,
  opts,
  done,
) => {
  const { store } = opts;
  const { db, config } = app.ctx;
  const lastAt = new Map<string, number>();

  app.post(
    '/sessions/:id/screenshots',
    { bodyLimit: 1024 * 1024 },
    (request): ScreenshotUploadResponse => {
      if (!config.classroom) throw notFound('Not a classroom computer');
      const { id: sessionId } = SessionParams.parse(request.params);
      const token = request.headers['x-participant-token'];
      const participantId =
        typeof token === 'string' ? store.participantByToken(sessionId, token) : undefined;
      if (!participantId) throw new ApiHttpError(401, 'unauthorized', 'Join the lesson first');
      const studentId = store.getState(sessionId)?.participants[participantId]?.studentId;
      if (!studentId) throw new ApiHttpError(401, 'unauthorized', 'Join the lesson first');

      const body = ScreenshotUploadSchema.parse(request.body);
      const bytes = Buffer.from(body.jpeg, 'base64');
      if (bytes.length > MAX_JPEG_BYTES || !JPEG_MAGIC.every((b, i) => bytes[i] === b)) {
        throw new ApiHttpError(400, 'bad_image', 'A screenshot is a JPEG of at most 400 KB');
      }
      const key = `${sessionId}:${studentId}`;
      const now = Date.now();
      if (now - (lastAt.get(key) ?? 0) < MIN_INTERVAL_MS) {
        throw new ApiHttpError(429, 'too_often', 'One screenshot in five seconds');
      }
      lastAt.set(key, now);

      const id = randomUUID();
      const fileKey = `screenshots/${sessionId}/${id}.jpg`;
      const path = join(config.dataDir, fileKey);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      db.insert(schema.screenshots)
        .values({
          id,
          sessionId,
          studentId,
          kind: body.reason,
          takenAt: new Date(now).toISOString(),
          fileKey,
          width: body.width,
          height: body.height,
          bytes: bytes.length,
        })
        .run();
      request.log.info(
        { sessionId, studentId, reason: body.reason, bytes: bytes.length },
        'screenshot',
      );
      return { id };
    },
  );

  /** The picture itself, for the teacher of that class. */
  app.get('/screenshots/:id', { preHandler: requireTeacher }, (request, reply) => {
    const { id } = ShotParams.parse(request.params);
    const row = db.select().from(schema.screenshots).where(eq(schema.screenshots.id, id)).get();
    if (!row) throw notFound('Screenshot not found');
    requireSessionClass(db, request.teacher as Teacher, row.sessionId);
    let file: Buffer;
    try {
      file = readFileSync(join(config.dataDir, row.fileKey));
    } catch {
      throw notFound('Screenshot file not found');
    }
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=86400, immutable')
      .send(file);
  });

  done();
};
