import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { readTeacher } from './auth/teacher.js';
import type { Config } from './config.js';
import type { ContentStore } from './content/index.js';
import type { Db } from './db/index.js';
import { errorHandler } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/content.js';
import { demoRoutes } from './routes/demo.js';
import { healthRoutes } from './routes/health.js';

export interface AppContext {
  config: Config;
  db: Db;
  content: ContentStore;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
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
  return app;
}
