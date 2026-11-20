import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const required = {
  DEMO_TEACHER_PASSWORD: 'demo1234',
  SESSION_SECRET: 'a-long-enough-secret-value',
};

describe('loadConfig', () => {
  it('applies defaults and resolves relative paths against the base folder', () => {
    const config = loadConfig(required, '/srv/sinf');
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.env).toBe('development');
    expect(config.databasePath).toBe('/srv/sinf/data/sinf.db');
    expect(config.contentDir).toBe('/srv/sinf/content');
    expect(config.logLevel).toBe('info');
  });

  it('keeps absolute paths and parses numbers', () => {
    const config = loadConfig(
      { ...required, PORT: '8080', DATABASE_PATH: '/var/lib/sinf.db' },
      '/x',
    );
    expect(config.port).toBe(8080);
    expect(config.databasePath).toBe('/var/lib/sinf.db');
  });

  it('rejects a short SESSION_SECRET and a bad PORT', () => {
    expect(() => loadConfig({ ...required, SESSION_SECRET: 'short' }, '/x')).toThrow(
      /SESSION_SECRET/,
    );
    expect(() => loadConfig({ ...required, PORT: 'abc' }, '/x')).toThrow(/PORT/);
    expect(() => loadConfig({ SESSION_SECRET: required.SESSION_SECRET }, '/x')).toThrow(
      /DEMO_TEACHER_PASSWORD/,
    );
  });
});
