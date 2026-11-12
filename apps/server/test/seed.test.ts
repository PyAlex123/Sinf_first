import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PicsSchema } from '@sinf/shared';
import { verifySecret } from '../src/auth/password.js';
import { REPO_ROOT } from '../src/config.js';
import { schema } from '../src/db/index.js';
import {
  CODE_SEPARATOR,
  DEMO,
  DEMO_STUDENTS,
  isDatabaseEmpty,
  pictureCode,
  seedDemo,
} from '../src/db/seed.js';
import { TEACHER_PASSWORD, testDatabase } from './helpers.js';

describe('demo seed', () => {
  it('creates the school, the teacher and class 1А with 20 students', async () => {
    const { db, close } = testDatabase();
    expect(db.select().from(schema.schools).all()).toHaveLength(1);
    const teacher = db.select().from(schema.users).all();
    expect(teacher).toHaveLength(1);
    expect(teacher[0]?.email).toBe(DEMO.teacherEmail);
    await expect(verifySecret(TEACHER_PASSWORD, teacher[0]?.passwordHash ?? '')).resolves.toBe(
      true,
    );

    const classes = db.select().from(schema.classes).all();
    expect(classes).toHaveLength(1);
    expect(classes[0]).toMatchObject({ name: '1А', grade: 1, settings: { starsToGrade: false } });

    const students = db.select().from(schema.students).all();
    expect(students).toHaveLength(20);
    expect(students.map((s) => `${s.lastName} ${s.firstName}`)).toEqual(
      DEMO_STUDENTS.map((s) => `${s.lastName} ${s.firstName}`),
    );
    expect(new Set(students.map((s) => s.codePublic)).size).toBe(20);
    const first = students[0];
    if (!first) throw new Error('no students');
    await expect(verifySecret(first.codePublic, first.codeHash)).resolves.toBe(true);
    close();
  });

  it('uses picture codes of two different pictures that exist in pics.json', () => {
    const pics = PicsSchema.parse(
      JSON.parse(readFileSync(resolve(REPO_ROOT, 'content/1-klass-2-chetvert/pics.json'), 'utf8')),
    );
    for (const key of DEMO.codePics) expect(pics[key], key).toBeDefined();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const [a, b] = pictureCode(i);
      expect(a).not.toBe(b);
      expect(DEMO.codePics).toContain(a);
      seen.add(`${a}${CODE_SEPARATOR}${b}`);
    }
    expect(seen.size).toBe(20);
  });

  it('isDatabaseEmpty is true before and false after seeding', () => {
    const { db, close } = testDatabase(false);
    expect(isDatabaseEmpty(db)).toBe(true);
    seedDemo(db, { teacherPassword: TEACHER_PASSWORD });
    expect(isDatabaseEmpty(db)).toBe(false);
    close();
  });
});
