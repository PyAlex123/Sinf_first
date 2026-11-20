import type { FastifyPluginCallback } from 'fastify';
import type { HealthResponse } from '@sinf/shared';

export const healthRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/health', (): HealthResponse => ({ status: 'ok' }));
  done();
};
