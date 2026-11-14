import type { FastifyServerOptions } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { loadContent } from './content/index.js';
import { openDatabase } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { ensureSuperadmin, isDatabaseEmpty, seedDemo } from './db/seed.js';

async function main(): Promise<void> {
  const envFile = loadDotEnv();
  const config = loadConfig();
  const logger: FastifyServerOptions['logger'] =
    config.env === 'production'
      ? { level: config.logLevel }
      : {
          level: config.logLevel,
          transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
        };

  const database = openDatabase(config.databasePath);
  runMigrations(database.db);
  const seeded = isDatabaseEmpty(database.db)
    ? seedDemo(database.db, { teacherPassword: config.demoTeacherPassword })
    : null;
  const superadmin = config.superadmin ? ensureSuperadmin(database.db, config.superadmin) : null;
  const content = loadContent(config.contentDir);

  const app = await buildApp({ config, db: database.db, content }, { logger });
  app.log.info(
    {
      envFile: envFile ?? null,
      database: config.databasePath,
      content: config.contentDir,
      lessons: content.courses.reduce((n, c) => n + c.lessons.length, 0),
      seeded: seeded ? `${seeded.students} students` : false,
      superadmin: config.superadmin ? (superadmin?.created ? 'created' : 'present') : 'off',
    },
    'starting',
  );

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => {
      database.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
