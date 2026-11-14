import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, REPO_ROOT, type Config } from '../src/config.js';
import { loadContent, type ContentStore } from '../src/content/index.js';
import { openDatabase, type DatabaseHandle } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';

export const TEACHER_PASSWORD = 'demo1234';

export function testConfig(overrides: Partial<Record<string, string>> = {}): Config {
  return loadConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      DEMO_TEACHER_PASSWORD: TEACHER_PASSWORD,
      SESSION_SECRET: 'test-secret-at-least-16-chars',
      CONTENT_DIR: resolve(REPO_ROOT, 'content'),
      // API tests must not depend on a built web client; the SPA test passes its own folder.
      WEB_DIR: resolve(REPO_ROOT, 'apps/web/__no_dist__'),
      ...overrides,
    },
    REPO_ROOT,
  );
}

/** Fresh in-memory database with migrations applied and the demo data seeded. */
export function testDatabase(seed = true): DatabaseHandle {
  const handle = openDatabase(':memory:');
  runMigrations(handle.db);
  if (seed) {
    seedDemo(handle.db, { teacherPassword: TEACHER_PASSWORD });
  }
  return handle;
}

let cachedContent: ContentStore | undefined;
export function testContent(): ContentStore {
  cachedContent ??= loadContent(resolve(REPO_ROOT, 'content'));
  return cachedContent;
}

export interface TestApp {
  app: FastifyInstance;
  database: DatabaseHandle;
  config: Config;
  close: () => Promise<void>;
}

export async function testApp(): Promise<TestApp> {
  const config = testConfig();
  const database = testDatabase();
  const app = await buildApp({ config, db: database.db, content: testContent() });
  await app.ready();
  return {
    app,
    database,
    config,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}

/** Logs the demo teacher in and returns the cookie header for later requests. */
export async function loginTeacher(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/teacher',
    payload: { email: 'demo@sinf.local', password: TEACHER_PASSWORD },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Login failed: ${res.statusCode} ${res.body}`);
  }
  const cookie = res.cookies.find((c) => c.name === 'sinf_teacher');
  if (!cookie) {
    throw new Error('No teacher cookie');
  }
  return `${cookie.name}=${cookie.value}`;
}
