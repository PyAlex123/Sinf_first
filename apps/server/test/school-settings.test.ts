import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHOOL_SETTINGS,
  readSchoolSettings,
  SchoolSettingsResponseSchema,
} from '@sinf/shared';
import { DEMO } from '../src/db/seed.js';
import { applySchoolSnapshot } from '../src/sync/mirror.js';
import { buildSchoolSnapshot } from '../src/sync/snapshot.js';
import { settingsForClass } from '../src/services/school-settings.js';
import { loginTeacher, registerTeacher, testApp, testDatabase, type TestApp } from './helpers.js';

/** A1 (stage 5): the rules of a school, set by its administrator. */

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

const url = `/api/schools/${DEMO.schoolId}/settings`;
const settings = (res: { json: () => unknown }) =>
  SchoolSettingsResponseSchema.parse(res.json()).settings;

describe('the rules of a school', () => {
  it('start as the defaults, and an old row with only the KTP share keeps it', () => {
    expect(readSchoolSettings({})).toEqual(DEFAULT_SCHOOL_SETTINGS);
    expect(readSchoolSettings({ ktpChangePercent: 40 }).ktpChangePercent).toBe(40);
    // A broken value is its default, not an error.
    expect(readSchoolSettings({ fileQuotaMb: 'много', apps: 5 })).toEqual(DEFAULT_SCHOOL_SETTINGS);
    // A file bigger than the folder cannot be kept.
    expect(readSchoolSettings({ fileQuotaMb: 20, maxFileMb: 50 }).maxFileMb).toBe(20);
  });

  it('are changed by the administrator, field by field, and refused when wrong', async () => {
    expect(settings(await t.app.inject({ method: 'GET', url, headers: { cookie } }))).toEqual(
      DEFAULT_SCHOOL_SETTINGS,
    );
    const res = await t.app.inject({
      method: 'PATCH',
      url,
      headers: { cookie },
      payload: { fileQuotaMb: 100, keepWorksUntil: '06-30', apps: ['word', 'paint'] },
    });
    expect(res.statusCode).toBe(200);
    // Programs come back in the platform's order, whatever order they were sent in.
    expect(settings(res)).toMatchObject({
      fileQuotaMb: 100,
      maxFileMb: 50,
      keepWorksUntil: '06-30',
      apps: ['paint', 'word'],
      ktpChangePercent: 30,
    });
    expect(settingsForClass(t.database.db, 'class-1a').fileQuotaMb).toBe(100);

    for (const payload of [
      { keepWorksUntil: '02-30' },
      { fileQuotaMb: 500 },
      { apps: ['minecraft'] },
      {},
    ]) {
      const bad = await t.app.inject({ method: 'PATCH', url, headers: { cookie }, payload });
      expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('are the administrator’s only', async () => {
    const other = await registerTeacher(t.app);
    for (const method of ['GET', 'PATCH'] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: { cookie: other },
        ...(method === 'PATCH' ? { payload: { fileQuotaMb: 10 } } : {}),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('travel to the school computer with the roster', async () => {
    await t.app.inject({
      method: 'PATCH',
      url,
      headers: { cookie },
      payload: { maxFileMb: 10, apps: ['word'] },
    });
    const snapshot = buildSchoolSnapshot(t.database.db, DEMO.schoolId);
    expect(snapshot?.settings).toMatchObject({ maxFileMb: 10, apps: ['word'] });

    const pc = testDatabase(false);
    try {
      if (!snapshot) throw new Error('no snapshot');
      applySchoolSnapshot(pc.db, snapshot);
      expect(settingsForClass(pc.db, 'class-1a')).toMatchObject({ maxFileMb: 10, apps: ['word'] });
      // A later change comes down too.
      applySchoolSnapshot(pc.db, {
        ...snapshot,
        settings: { ...settingsForClass(pc.db, 'class-1a'), maxFileMb: 5 },
      });
      expect(settingsForClass(pc.db, 'class-1a').maxFileMb).toBe(5);
    } finally {
      pc.close();
    }
  });
});
