import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SchoolSettingsResponseSchema } from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { DEMO } from '../src/db/seed.js';
import { purgeOldWorks, retentionCutoffs } from '../src/services/retention.js';
import { blobPath } from '../src/services/student-files.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** A4 (stage 5): works and screenshots go on the school's day; grades stay. */

const NOW = new Date('2026-11-21T09:00:00.000Z');
const OLD = '2026-05-10T06:00:00.000Z';
const NEW = '2026-10-01T06:00:00.000Z';

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

describe('the day works are kept until', () => {
  it('ends at the start of the next day in Tashkent, once a year', () => {
    expect(retentionCutoffs('07-31', NOW)).toEqual({
      last: new Date('2026-07-31T19:00:00.000Z'),
      next: new Date('2027-07-31T19:00:00.000Z'),
    });
    // An hour before the day ends there, the cleaning of this year has not come yet.
    expect(retentionCutoffs('07-31', new Date('2026-07-31T18:00:00.000Z')).last).toEqual(
      new Date('2025-07-31T19:00:00.000Z'),
    );
    expect(retentionCutoffs('12-31', NOW).next).toEqual(new Date('2026-12-31T19:00:00.000Z'));
  });
});

/** One of each kind of work, made in spring (`OLD`) or this autumn (`NEW`). */
function makeWorks(when: string, tag: string) {
  const db = t.database.db;
  const dataDir = t.config.dataDir;
  const sessionId = `session-${tag}`;
  db.insert(schema.sessions)
    .values({
      id: sessionId,
      classId: 'class-1a',
      lessonId: 'g10',
      teacherId: DEMO.teacherId,
      joinCode: `9${tag.length}${tag.charCodeAt(0)}`.slice(0, 6).padEnd(6, '0'),
      status: 'ended',
      startedAt: when,
      endedAt: when,
    })
    .run();
  const shotKey = `screenshots/${sessionId}/${tag}.jpg`;
  mkdirSync(dirname(join(dataDir, shotKey)), { recursive: true });
  writeFileSync(join(dataDir, shotKey), 'jpg');
  db.insert(schema.screenshots)
    .values({
      id: `shot-${tag}`,
      sessionId,
      studentId: 'student-01',
      kind: 'manual',
      takenAt: when,
      fileKey: shotKey,
      width: 1,
      height: 1,
      bytes: 3,
    })
    .run();
  const blob = (sha: string) => {
    mkdirSync(dirname(blobPath(dataDir, sha)), { recursive: true });
    writeFileSync(blobPath(dataDir, sha), sha);
    return sha;
  };
  const fileSha = blob(tag.repeat(64).slice(0, 64));
  db.insert(schema.studentFiles)
    .values({
      id: `file-${tag}`,
      studentId: 'student-01',
      name: `${tag}.docx`,
      nameKey: `${tag}.docx`,
      size: 64,
      sha256: fileSha,
      updatedAt: when,
      origin: 'браузер',
    })
    .run();
  const handed = blob(`${tag}f`.repeat(64).slice(0, 64));
  db.insert(schema.practiceChecks)
    .values({
      sessionId,
      studentId: 'student-01',
      fileName: 'Документ.docx',
      fileSha: handed,
      submittedName: 'Документ.docx',
      submittedSha: handed,
      marks: { m1: true },
    })
    .run();
  db.insert(schema.grades)
    .values({
      id: `grade-${tag}`,
      studentId: 'student-01',
      classId: 'class-1a',
      sessionId,
      date: when.slice(0, 10),
      stars: 5,
      value: 5,
      source: 'manual',
      createdAt: when,
    })
    .run();
  return { shotKey, fileSha, handed };
}

describe('the cleaning', () => {
  it('takes last year’s works, leaves this year’s, and keeps the grades', () => {
    const old = makeWorks(OLD, 'a');
    const fresh = makeWorks(NEW, 'b');
    const dataDir = t.config.dataDir;

    expect(purgeOldWorks(t.database.db, dataDir, NOW)).toEqual({
      screenshots: 1,
      files: 1,
      practiceFiles: 1,
    });
    expect(existsSync(join(dataDir, old.shotKey))).toBe(false);
    expect(existsSync(blobPath(dataDir, old.fileSha))).toBe(false);
    expect(existsSync(blobPath(dataDir, old.handed))).toBe(false);
    expect(existsSync(join(dataDir, fresh.shotKey))).toBe(true);
    expect(existsSync(blobPath(dataDir, fresh.fileSha))).toBe(true);
    expect(existsSync(blobPath(dataDir, fresh.handed))).toBe(true);

    const db = t.database.db;
    expect(
      db
        .select()
        .from(schema.screenshots)
        .all()
        .map((s) => s.id),
    ).toEqual(['shot-b']);
    expect(
      db
        .select()
        .from(schema.studentFiles)
        .all()
        .map((f) => f.id),
    ).toEqual(['file-b']);
    // The practice row stays with its name and marks; only the file is gone.
    const check = db
      .select()
      .from(schema.practiceChecks)
      .all()
      .find((c) => c.sessionId === 'session-a');
    expect(check).toMatchObject({ fileSha: null, submittedSha: null, marks: { m1: true } });
    expect(db.select().from(schema.grades).all()).toHaveLength(2);

    // Twice is the same as once.
    expect(purgeOldWorks(db, dataDir, NOW)).toEqual({ screenshots: 0, files: 0, practiceFiles: 0 });
  });

  it('follows the school’s day, and tells the administrator what the next one takes', async () => {
    makeWorks(OLD, 'a');
    const patched = await t.app.inject({
      method: 'PATCH',
      url: `/api/schools/${DEMO.schoolId}/settings`,
      headers: { cookie },
      payload: { keepWorksUntil: '12-31' },
    });
    // Until 31 December: spring's works belong to a year not over yet.
    expect(purgeOldWorks(t.database.db, t.config.dataDir, NOW).screenshots).toBe(0);
    const { retention } = SchoolSettingsResponseSchema.parse(patched.json());
    // The route asks the real clock: the next cleaning is the next 1 January in Tashkent.
    const next = retentionCutoffs('12-31', new Date()).next;
    expect(retention).toMatchObject({
      on: new Date(next.getTime() + 5 * 3_600_000).toISOString().slice(0, 10),
      screenshots: 1,
      files: 1,
      practiceFiles: 1,
    });
    expect(retention?.on.slice(5)).toBe('01-01');
  });
});
