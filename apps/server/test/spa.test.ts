import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testConfig, testContent, testDatabase, type TestApp } from './helpers.js';

let t: TestApp;
let webDir: string;

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'sinf-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(
    join(webDir, 'index.html'),
    '<!doctype html><title>Sinf</title><div id="app"></div>',
  );
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
  const config = testConfig({ WEB_DIR: webDir });
  const database = testDatabase();
  const app = await buildApp({ config, db: database.db, content: testContent() });
  await app.ready();
  t = {
    app,
    database,
    config,
    close: async () => {
      await app.close();
      database.close();
    },
  };
});

afterAll(async () => {
  await t.close();
  rmSync(webDir, { recursive: true, force: true });
});

describe('built web client', () => {
  it('serves index.html for the app routes with revalidation', async () => {
    for (const url of ['/', '/join', '/teacher/session/abc', '/s/x?y=1']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('<div id="app">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('serves hashed assets as immutable', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('keeps API, content and non-GET 404s as JSON', async () => {
    const api = await t.app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ error: 'not_found' });
    const content = await t.app.inject({ method: 'GET', url: '/content/nope.json' });
    expect(content.statusCode).toBe(404);
    const post = await t.app.inject({ method: 'POST', url: '/join' });
    expect(post.statusCode).toBe(404);
  });
});
