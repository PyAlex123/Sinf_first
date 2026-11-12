import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

/** Server configuration from environment variables (`.env.example` lists them). */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().min(1).default('data'),
  DATABASE_PATH: z.string().min(1).default('data/sinf.db'),
  CONTENT_DIR: z.string().min(1).default('content'),
  WEB_DIR: z.string().min(1).default('apps/web/dist'),
  DEMO_TEACHER_PASSWORD: z.string().min(6, 'DEMO_TEACHER_PASSWORD must be at least 6 characters'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  /** Absolute paths. */
  dataDir: string;
  databasePath: string;
  contentDir: string;
  /** Built web client (served when the folder exists; in development Vite serves it). */
  webDir: string;
  demoTeacherPassword: string;
  sessionSecret: string;
  logLevel: (typeof LOG_LEVELS)[number];
}

/** Repository root: apps/server/src/config.ts and apps/server/dist/config.js are both three levels below it. */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Base for relative paths in env: the folder the command was typed in (`INIT_CWD`, set by pnpm, because pnpm
 * runs package scripts inside `apps/server`), otherwise the current folder.
 */
export function pathBase(env: NodeJS.ProcessEnv = process.env): string {
  return env['INIT_CWD'] ?? process.cwd();
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  base: string = pathBase(env),
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  const e = parsed.data;
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(base, p));
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    dataDir: abs(e.DATA_DIR),
    databasePath: abs(e.DATABASE_PATH),
    contentDir: abs(e.CONTENT_DIR),
    webDir: abs(e.WEB_DIR),
    demoTeacherPassword: e.DEMO_TEACHER_PASSWORD,
    sessionSecret: e.SESSION_SECRET,
    logLevel: e.LOG_LEVEL,
  };
}

/** Loads `.env` from the command folder or the repository root, if present. Existing variables win. */
export function loadDotEnv(): string | undefined {
  for (const dir of [pathBase(), REPO_ROOT]) {
    const file = resolve(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
  }
  return undefined;
}
