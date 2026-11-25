import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  UPDATE_VERSION,
  UpdateManifestSchema,
  type AdminUpdatesResponse,
  type LatestUpdateResponse,
  type StoredUpdate,
  type Teacher,
} from '@sinf/shared';
import { requireSuperadmin } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { notFound } from '../errors.js';
import {
  installerPath,
  latestUpdate,
  lessonOn,
  listUpdates,
  removeUpdate,
  storeUpdate,
  updatesDir,
} from '../services/updates.js';

const VersionParams = z.object({ version: z.string().regex(UPDATE_VERSION) });

/**
 * Updates of the Windows app (B6, ADR-023). The computers ask what is newest and download it without
 * logging in: an installer is no secret, and what makes it trusted is its signature, checked by the
 * updater. Only the superadmin puts new versions on the platform.
 */
export const updateRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db, config } = app.ctx;
  const dir = updatesDir(config);

  // The installer arrives as raw bytes and goes to disk as a stream, never whole into memory.
  app.addContentTypeParser('application/octet-stream', (_request, payload, parsed) => {
    parsed(null, payload);
  });

  app.get('/updates/latest', async (): Promise<LatestUpdateResponse> => {
    const latest = await latestUpdate(dir);
    const update = latest ? UpdateManifestSchema.parse(stripStored(latest)) : null;
    return { update, busy: lessonOn(db, config, app.sync?.link() ?? null) };
  });

  app.get('/updates/:version/installer', async (request, reply) => {
    const { version } = VersionParams.parse(request.params);
    const found = (await listUpdates(dir)).find((u) => u.version === version);
    if (!found) throw notFound('Update');
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(found.size))
      .header('content-disposition', `attachment; filename="${found.file}"`)
      .header('x-sinf-sha256', found.sha256)
      .send(createReadStream(installerPath(dir, found)));
  });

  app.get(
    '/admin/updates',
    { preHandler: requireTeacher },
    async (request): Promise<AdminUpdatesResponse> => {
      requireSuperadmin(db, request.teacher as Teacher);
      return { updates: await listUpdates(dir), checksSignatures: !!config.updatePublicKey };
    },
  );

  /** `update.json` in the query, the installer as the body. */
  app.put(
    '/admin/updates/:version',
    { preHandler: requireTeacher },
    async (request): Promise<{ update: StoredUpdate }> => {
      requireSuperadmin(db, request.teacher as Teacher);
      const { version } = VersionParams.parse(request.params);
      const query = request.query as Record<string, string | undefined>;
      const manifest = UpdateManifestSchema.parse({
        version,
        file: query.file,
        sha256: query.sha256,
        size: Number(query.size),
        signature: query.signature,
      });
      const update = await storeUpdate(
        dir,
        manifest,
        request.body as Readable,
        config.updatePublicKey,
      );
      request.log.info({ version }, 'update uploaded');
      return { update };
    },
  );

  app.delete(
    '/admin/updates/:version',
    { preHandler: requireTeacher },
    async (request): Promise<{ ok: true }> => {
      requireSuperadmin(db, request.teacher as Teacher);
      const { version } = VersionParams.parse(request.params);
      if (!(await removeUpdate(dir, version))) throw notFound('Update');
      return { ok: true };
    },
  );

  done();
};

const stripStored = ({ storedAt: _storedAt, ...manifest }: StoredUpdate) => manifest;
