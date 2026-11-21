import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  guessKtpMapping,
  KtpListResponseSchema,
  KtpPlanSchema,
  mapKtpRows,
  ParsedTablesSchema,
  type KtpRowInput,
} from '@sinf/shared';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** W10 (PLAN.md 5.2): a KTP from Excel or Word, through the wizard, saved, and back to Excel. */

const FIXTURES = join(import.meta.dirname, 'fixtures', 'ktp');

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await testApp();
  cookie = await loginTeacher(t.app);
});

afterEach(async () => {
  await t.close();
});

const parse = async (file: string, as = cookie) =>
  t.app.inject({
    method: 'POST',
    url: `/api/ktp/parse?name=${encodeURIComponent(file)}`,
    headers: { cookie: as, 'content-type': 'application/octet-stream' },
    payload: readFileSync(join(FIXTURES, file)),
  });

/** What the wizard does in the browser: guess, map, keep the good rows. */
async function rowsOf(file: string): Promise<KtpRowInput[]> {
  const { tables } = ParsedTablesSchema.parse((await parse(file)).json());
  const rows = tables[0]?.rows ?? [];
  const { header, mapping } = guessKtpMapping(rows);
  return mapKtpRows(rows, header, mapping).flatMap((p) => (p.row ? [p.row] : []));
}

describe('reading a KTP file', () => {
  it('finds the topics of an Excel KTP under its title row', async () => {
    const rows = await rowsOf('ktp.xlsx');
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ number: '1', hours: 1 });
    expect(rows[0]?.topic).toMatch(/\S/);
    // A date cell of Excel comes as a date, not as a day number.
    expect(rows.some((r) => /^\d{2}\.\d{2}\.\d{4}$/.test(r.weekOrDate))).toBe(true);
  });

  it('finds the topics of a Word KTP, skipping the quarter rows', async () => {
    const rows = await rowsOf('ktp.docx');
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.every((r) => !/четверть/i.test(r.topic))).toBe(true);
  });

  it('refuses a file it cannot read, and an old .doc', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/ktp/parse?name=plan.xlsx',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('not a zip at all'),
    });
    expect(res.statusCode).toBe(422);
    const doc = await t.app.inject({
      method: 'POST',
      url: '/api/ktp/parse?name=plan.doc',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('old'),
    });
    expect(doc.statusCode).toBe(422);
  });
});

describe('a saved KTP', () => {
  it('is kept row by row, is its teacher’s only, and goes back to Excel', async () => {
    const rows = await rowsOf('ktp.xlsx');
    const made = await t.app.inject({
      method: 'POST',
      url: '/api/ktp',
      headers: { cookie },
      payload: { classId: 'class-1a', title: 'Информатика', sourceFile: 'ktp.xlsx', rows },
    });
    expect(made.statusCode).toBe(200);
    const plan = KtpPlanSchema.parse(made.json());
    expect(plan).toMatchObject({ className: '1А', rows: 8, done: 0, sourceFile: 'ktp.xlsx' });
    expect(plan.items.map((i) => i.topic)).toEqual(rows.map((r) => r.topic));

    const list = KtpListResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/ktp', headers: { cookie } })).json(),
    );
    expect(list.plans.map((p) => p.id)).toEqual([plan.id]);

    // Another teacher does not see it.
    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'other@example.com', password: 'other-pass-1', fullName: 'Другая' },
    });
    const jar = reg.cookies.find((c) => c.name === 'sinf_teacher');
    const other = `${jar?.name}=${jar?.value}`;
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/ktp/${plan.id}`,
          headers: { cookie: other },
        })
      ).statusCode,
    ).toBe(404);
    // Nor can they put a KTP on a class that is not theirs.
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/ktp',
          headers: { cookie: other },
          payload: { classId: 'class-1a', title: 'Чужой', rows },
        })
      ).statusCode,
    ).toBe(404);

    const file = await t.app.inject({
      method: 'GET',
      url: `/api/ktp/${plan.id}/export.xlsx?lang=ru`,
      headers: { cookie },
    });
    expect(file.statusCode).toBe(200);
    const sheet = strFromU8(
      unzipSync(new Uint8Array(file.rawPayload))['xl/worksheets/sheet1.xml']!,
    );
    expect(sheet).toContain('Тема урока');
    expect(sheet).toContain(rows[7]?.topic ?? '?');

    const gone = KtpListResponseSchema.parse(
      (
        await t.app.inject({ method: 'DELETE', url: `/api/ktp/${plan.id}`, headers: { cookie } })
      ).json(),
    );
    expect(gone.plans).toEqual([]);
  });

  it('refuses rows without a topic', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/ktp',
      headers: { cookie },
      payload: { classId: 'class-1a', title: 'Пусто', rows: [{ topic: '  ' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
