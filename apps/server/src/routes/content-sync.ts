import { createReadStream, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContentManifest } from '@sinf/shared';
import { requireContentAccess } from '../auth/access.js';
import { notFound } from '../errors.js';

const FileQuery = z.object({ path: z.string().min(1).max(300) });

/**
 * Handing the lesson material to a school computer (S2.5). The computer asks what exists, compares it
 * with its own copy and fetches only what it lacks; then the lesson runs from that copy with no
 * internet at all (CLAUDE.md §3.3).
 *
 * Both routes go through `requireContentAccess`, the single place a licence check will go (ADR-009).
 */
export const contentSyncRoutes: FastifyPluginCallback<{ manifest: ContentManifest }> = (
  app,
  opts,
  done,
) => {
  const { db, config } = app.ctx;
  const { manifest } = opts;
  // Only paths the manifest knows are served: nothing else can be asked for, whatever the request says.
  const known = new Map(
    manifest.courses.flatMap((course) => course.files.map((file) => [file.path, file] as const)),
  );

  const guard = async (request: FastifyRequest): Promise<void> => {
    await requireContentAccess(db, request.teacher ?? null, request.headers.authorization);
  };

  app.get('/content/manifest', async (request): Promise<ContentManifest> => {
    await guard(request);
    return manifest;
  });

  app.get('/content/file', async (request, reply: FastifyReply) => {
    await guard(request);
    const { path } = FileQuery.parse(request.query);
    const file = known.get(path);
    if (!file) throw notFound('File');
    const full = join(config.contentDir, ...path.split(posix.sep));
    if (!existsSync(full)) throw notFound('File');
    void reply.header('content-type', 'application/octet-stream');
    void reply.header('content-length', String(file.size));
    void reply.header('x-sinf-sha256', file.sha256);
    return reply.send(createReadStream(full));
  });

  done();
};
