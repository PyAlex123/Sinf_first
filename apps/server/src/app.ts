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
import { healthRoutes } from './routes/health.js';
import { joinRoutes } from './routes/join.js';
import { sessionRoutes } from './routes/sessions.js';

export interface AppContext {
  config: Config;
  db: Db;
  content: ContentStore;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    sessions: SessionStore;
  }
}

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function buildApp(
  ctx: AppContext,
  options: { logger?: FastifyServerOptions['logger'] } = {},
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
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(contentRoutes, { prefix: '/api' });
  await app.register(demoRoutes, { prefix: '/api' });
  await app.register(classRoutes, { prefix: '/api' });
  await app.register(sessionRoutes, { prefix: '/api', store });
  await app.register(joinRoutes, { prefix: '/api', store });
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
