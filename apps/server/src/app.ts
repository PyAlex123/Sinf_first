import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { readTeacher } from './auth/teacher.js';
import type { Config } from './config.js';
import type { ContentStore } from './content/index.js';
import type { Db } from './db/index.js';
import { errorHandler } from './errors.js';
import { SessionStore } from './realtime/session-store.js';
import { realtimePlugin } from './realtime/ws.js';
import { authRoutes } from './routes/auth.js';
import { classRoutes } from './routes/classes.js';
import { contentRoutes } from './routes/content.js';
import { demoRoutes } from './routes/demo.js';
import { buildContentManifest } from './content/manifest.js';
import { contentSyncRoutes } from './routes/content-sync.js';
import { deviceRoutes } from './routes/devices.js';
import { healthRoutes } from './routes/health.js';
import { schoolRoutes } from './routes/schools.js';
import { joinRoutes } from './routes/join.js';
import { resultRoutes } from './routes/results.js';
import { screenshotRoutes } from './routes/screenshots.js';
import { sessionRoutes } from './routes/sessions.js';
import { syncRoutes } from './routes/sync.js';
import { fileRoutes } from './routes/files.js';
import { ensureHomeCodes } from './services/student-files.js';
import { clearUploadLeftovers } from './sync/files.js';
import { SyncWorker } from './sync/worker.js';
import { VirtualStudents } from './services/virtual-students.js';

export interface AppContext {
  config: Config;
  db: Db;
  content: ContentStore;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    sessions: SessionStore;
    /** Virtual students of the demo lesson (S1.15). */
    virtual: VirtualStudents;
    /** Set only on a school computer (S2.6); null when this server is the platform. */
    sync: SyncWorker | null;
  }
}

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function buildApp(
  ctx: AppContext,
  options: {
    logger?: FastifyServerOptions['logger'];
    /** Tests pass their own, so they can drive the ticks themselves. */
    sync?: SyncWorker | null;
    /** How a school computer reaches the platform when a teacher logs in (S2.6); tests replace it. */
    platformFetch?: typeof fetch;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  app.decorate('ctx', ctx);
  app.decorateRequest('teacher', null);
  app.setErrorHandler(errorHandler);

  await app.register(fastifyCookie, { secret: ctx.config.sessionSecret });
  app.addHook('onRequest', (request, _reply, done) => {
    request.teacher = readTeacher(request, ctx.db);
    done();
  });

  const store = new SessionStore(ctx.db, ctx.content, app.log);
  app.decorate('sessions', store);
  const virtual = new VirtualStudents(store, ctx.content, app.log);
  app.decorate('virtual', virtual);
  app.addHook('onClose', (_instance, done) => {
    virtual.close();
    done();
  });

  /*
   * School-computer mode (S2.6): this server was told where the platform is, so it mirrors the
   * school's roster down and sends lesson results up. On the platform itself nothing is created and
   * no timer runs.
   */
  const worker =
    options.sync !== undefined
      ? options.sync
      : ctx.config.platformConfigFile || ctx.config.platformLink
        ? new SyncWorker(ctx.db, ctx.config, app.log)
        : null;
  app.decorate('sync', worker);
  // Class codes for "Мои работы" at home are the platform's to make (H12); a school computer gets
  // them with the roster, and making its own could clash with the platform's.
  if (!worker) ensureHomeCodes(ctx.db);
  // An upload cut off by a power cut leaves half a file behind; it belongs to nobody.
  await clearUploadLeftovers(ctx.config.dataDir);
  if (worker) {
    // A lesson that has just ended should not wait a minute for its turn.
    store.onSessionEnded = () => void worker.push();
    app.addHook('onReady', () => {
      worker.start();
    });
    app.addHook('onClose', () => {
      worker.stop();
    });
  }

  // Imported lesson content. Media files are named by content hash (ADR-005), so they are cached for a year;
  // JSON, CSS and scenarios are revalidated.
  await app.register(fastifyStatic, {
    root: ctx.config.contentDir,
    prefix: '/content/',
    decorateReply: false,
    cacheControl: false,
    etag: true,
    index: false,
    list: false,
    setHeaders(res, path) {
      const immutable = /[/\\]media[/\\][0-9a-f]+\.webp$/.test(path);
      void res.header(
        'Cache-Control',
        immutable ? `public, max-age=${YEAR_SECONDS}, immutable` : 'no-cache',
      );
    },
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    prefix: '/api',
    ...(options.platformFetch ? { platformFetch: options.platformFetch } : {}),
  });
  await app.register(contentRoutes, { prefix: '/api' });
  await app.register(demoRoutes, { prefix: '/api', store, virtual });
  await app.register(classRoutes, { prefix: '/api' });
  await app.register(schoolRoutes, { prefix: '/api' });
  await app.register(deviceRoutes, { prefix: '/api' });
  await app.register(contentSyncRoutes, {
    prefix: '/api',
    manifest: buildContentManifest(ctx.config.contentDir),
  });
  await app.register(syncRoutes, { prefix: '/api', worker });
  await app.register(sessionRoutes, { prefix: '/api', store });
  await app.register(resultRoutes, { prefix: '/api' });
  await app.register(screenshotRoutes, { prefix: '/api', store });
  await app.register(joinRoutes, { prefix: '/api', store });
  await app.register(fileRoutes, { prefix: '/api', store });
  await app.register(realtimePlugin, { store });

  // Built web client (single-page app). In development Vite serves it and proxies /api, /ws, /content here.
  const indexHtml = join(ctx.config.webDir, 'index.html');
  if (existsSync(indexHtml)) {
    await app.register(fastifyStatic, {
      root: ctx.config.webDir,
      prefix: '/',
      decorateReply: true,
      wildcard: false,
      index: ['index.html'],
      cacheControl: false,
      etag: true,
      setHeaders(res, path) {
        // Vite names hashed assets under /assets; index.html must always be revalidated.
        const immutable = /[/\\]assets[/\\]/.test(path);
        void res.header(
          'Cache-Control',
          immutable ? `public, max-age=${YEAR_SECONDS}, immutable` : 'no-cache',
        );
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      const isApi = path.startsWith('/api') || path.startsWith('/content') || path === '/ws';
      if (request.method !== 'GET' || isApi) {
        void reply.status(404).send({ error: 'not_found', message: 'Not found' });
        return;
      }
      void reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }
  return app;
}
