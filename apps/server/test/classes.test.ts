import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassDetailsResponseSchema, StudentCodeResponseSchema } from '@sinf/shared';
import { verifySecret } from '../src/auth/password.js';
import { schema } from '../src/db/index.js';
import {
  allPictureCodes,
  randomDigitCode,
  randomPictureCode,
  splitCode,
} from '../src/services/codes.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterAll(async () => {
  await t.close();
});

describe('code generation', () => {
  it('enumerates 30 ordered pairs for six pictures and avoids taken ones', () => {
    const pics = ['sun', 'ball', 'tree', 'apple', 'star', 'house'];
    const all = allPictureCodes(pics);
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);
    const taken = new Set(all.slice(0, 29));
    expect(randomPictureCode(pics, taken)).toBe(all[29]);
    expect(() => randomPictureCode(pics, new Set(all))).toThrow(/No free/);
  });

  it('makes four-digit codes and splits public codes', () => {
    expect(randomDigitCode(new Set(), () => 0.0001)).toBe('0001');
    expect(
      randomDigitCode(
        new Set(['0001']),
        (() => {
          let n = 0;
          return () => [0.0001, 0.5][n++ % 2] as number;
        })(),
      ),
    ).toBe('5000');
    expect(splitCode('pics', 'sun+ball')).toEqual(['sun', 'ball']);
    expect(splitCode('digits', '4071')).toEqual(['4', '0', '7', '1']);
  });
});

describe('GET /api/classes/:id', () => {
  it('needs a teacher', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/classes/class-1a' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the class and its students with picture codes in order', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/classes/class-1a',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = ClassDetailsResponseSchema.parse(res.json());
    expect(body.class).toMatchObject({ name: '1А', grade: 1, studentCount: 20 });
    expect(body.students).toHaveLength(20);
    expect(body.students.map((s) => s.sortOrder)).toEqual([...Array(20).keys()].map((i) => i + 1));
    for (const s of body.students) {
      expect(s.codeKind).toBe('pics');
      expect(s.code).toHaveLength(2);
      expect(body.class.settings.codePics).toContain(s.code[0]);
      expect(s.code[0]).not.toBe(s.code[1]);
    }
    expect(new Set(body.students.map((s) => s.code.join('+'))).size).toBe(20);
    const missing = await t.app.inject({
      method: 'GET',
      url: '/api/classes/nope',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /api/students/:id/code', () => {
  it('issues a new unique code and updates the hash', async () => {
    const before = t.database.db
      .select()
      .from(schema.students)
      .all()
      .find((s) => s.id === 'student-03');
    if (!before) throw new Error('seed');
    // Repeat a few times: a new code must never repeat the previous one.
    let previous = before.codePublic;
    for (let i = 0; i < 5; i++) {
      const again = await t.app.inject({
        method: 'POST',
        url: '/api/students/student-03/code',
        headers: { cookie },
      });
      const next = StudentCodeResponseSchema.parse(again.json()).student.code.join('+');
      expect(next).not.toBe(previous);
      previous = next;
    }
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/students/student-03/code',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { student } = StudentCodeResponseSchema.parse(res.json());
    const code = student.code.join('+');
    expect(code).not.toBe(previous);
    const rows = t.database.db.select().from(schema.students).all();
    const others = rows.filter((s) => s.id !== 'student-03').map((s) => s.codePublic);
    expect(others).not.toContain(code);
    const after = rows.find((s) => s.id === 'student-03');
    await expect(verifySecret(code, after?.codeHash ?? '')).resolves.toBe(true);
    await expect(verifySecret(before.codePublic, after?.codeHash ?? '')).resolves.toBe(false);
  });

  it('is teacher-only and 404 for unknown students', async () => {
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/students/student-03/code' })).statusCode,
    ).toBe(401);
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/students/nope/code', headers: { cookie } }))
        .statusCode,
    ).toBe(404);
  });
});
