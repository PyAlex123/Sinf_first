import { existsSync, readFileSync } from 'node:fs';
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
  /** Our own account (S2.3): only it creates schools. Both empty — no superadmin exists at all. */
  SUPERADMIN_EMAIL: z.string().optional(),
  SUPERADMIN_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  /**
   * School-computer mode (S2.6). The Windows app already keeps the platform address and this
   * machine's token in its `config.json`, so the server is pointed at that file and re-reads it:
   * pairing in the middle of the day then needs no restart. The two variables below are the plain
   * way to say the same thing in development and in tests. On the platform all three are empty.
   */
  PLATFORM_CONFIG_FILE: z.string().optional(),
  PLATFORM_URL: z.string().optional(),
  DEVICE_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /**
   * This server is the teacher's computer in a classroom (ADR-014): student computers on the same
   * network ask it which lesson to open, without a lesson code. Set by the Windows app; never on
   * the platform, where it would show any running lesson's class list to anyone who asks.
   */
  /**
   * The teacher's classroom app sends its screen to this server with this token (H14); set by the
   * app for its own server, random each start. Empty: no screen broadcast from a host app.
   */
  HOST_TOKEN: z.string().default(''),
  CLASSROOM_MODE: z.enum(['0', '1']).default('0'),
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
  superadmin: { email: string; password: string } | null;
  sessionSecret: string;
  logLevel: (typeof LOG_LEVELS)[number];
  /** Where to look for this computer's link to the platform; null on the platform itself. */
  platformConfigFile: string | null;
  platformLink: PlatformLink | null;
  /** The teacher's computer in a classroom: student computers find their lesson here (ADR-014). */
  classroom: boolean;
  /** The teacher's app's token for its screen broadcast (H14); null when not set. */
  hostToken: string | null;
}

/** This computer's link to the platform: where it is and who we are (S2.4). */
export interface PlatformLink {
  url: string;
  deviceToken: string;
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
    superadmin:
      e.SUPERADMIN_EMAIL && e.SUPERADMIN_PASSWORD
        ? { email: e.SUPERADMIN_EMAIL.trim().toLowerCase(), password: e.SUPERADMIN_PASSWORD }
        : null,
    sessionSecret: e.SESSION_SECRET,
    logLevel: e.LOG_LEVEL,
    platformConfigFile: e.PLATFORM_CONFIG_FILE ? abs(e.PLATFORM_CONFIG_FILE) : null,
    platformLink:
      e.PLATFORM_URL && e.DEVICE_TOKEN
        ? { url: normalizePlatformUrl(e.PLATFORM_URL), deviceToken: e.DEVICE_TOKEN }
        : null,
    classroom: e.CLASSROOM_MODE === '1',
    hostToken: e.HOST_TOKEN.length >= 16 ? e.HOST_TOKEN : null,
  };
}

/** "sinf.uz", "https://sinf.uz/" and "https://sinf.uz" mean the same thing (as in the app). */
export function normalizePlatformUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The link as it is right now. The file wins over the variables, because the app rewrites it the
 * moment the school pairs this computer; an unreadable or half-filled file simply means "not paired
 * yet", which is a normal state, not an error.
 */
export function readPlatformLink(config: Config): PlatformLink | null {
  if (config.platformConfigFile) {
    try {
      const raw = readFileSync(config.platformConfigFile, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const file = PlatformFileSchema.safeParse(parsed);
      if (file.success && file.data.PlatformUrl && file.data.DeviceToken) {
        return {
          url: normalizePlatformUrl(file.data.PlatformUrl),
          deviceToken: file.data.DeviceToken,
        };
      }
    } catch {
      // No file yet, or not readable: this computer is simply not attached to a school.
    }
  }
  return config.platformLink;
}

/** Only the two fields we need from the app's settings file; everything else is its own business. */
const PlatformFileSchema = z.looseObject({
  PlatformUrl: z.string().nullish(),
  DeviceToken: z.string().nullish(),
});

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
