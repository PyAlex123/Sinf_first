import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  guessKtpMapping,
  KtpLessonsResponseSchema,
  KtpListResponseSchema,
  KtpPlanSchema,
  SchoolDetailsResponseSchema,
  SessionKtpResponseSchema,
  SessionResponseSchema,
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
  for (const id of t.app.sessions.liveSessionIds()) t.app.sessions.end(id);
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

describe('the KTP and the lessons (W11)', () => {
  const topics = [
    { topic: 'Предыдущий и последующий', weekOrDate: '01.09.2026' },
    { topic: 'До и после', weekOrDate: '08.09.2026' },
    { topic: 'Последовательность действий', weekOrDate: '15.09.2026' },
    { topic: 'Повторение', weekOrDate: '2999-01-01' },
  ];
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const make = async () =>
    KtpPlanSchema.parse(
      (
        await call('POST', '/api/ktp', { classId: 'class-1a', title: 'Информатика', rows: topics })
      ).json(),
    );

  it('suggests lessons by title, links them, and knows how far the class is', async () => {
    let plan = await make();
    expect(plan.items.map((i) => i.suggestion?.id ?? null)).toEqual(['g10', 'g11', 'g14', null]);
    // All three dates are behind us; the fourth is not a date at all.
    expect(plan.planned).toBe(3);

    plan = KtpPlanSchema.parse(
      (
        await call('POST', `/api/ktp/${plan.id}/links`, {
          links: plan.items.flatMap((i) =>
            i.suggestion ? [{ rowId: i.id, lessonId: i.suggestion.id }] : [],
          ),
        })
      ).json(),
    );
    expect(plan.items.map((i) => i.lessonId)).toEqual(['g10', 'g11', 'g14', null]);
    expect(plan.items[0]?.lessonTitle).toBe('Предыдущий — последующий');
    // A lesson that does not exist is refused.
    expect(
      (
        await call('PATCH', `/api/ktp/${plan.id}/rows/${plan.items[3]?.id}`, {
          lessonId: 'nope',
        })
      ).statusCode,
    ).toBe(400);

    const catalog = KtpLessonsResponseSchema.parse(
      (await call('GET', `/api/ktp/${plan.id}/lessons`)).json(),
    );
    expect(catalog.lessons.some((l) => l.id === 'g15')).toBe(true);
  });

  it('after a lesson, offers its topic to mark done; done counts', async () => {
    let plan = await make();
    await call('PATCH', `/api/ktp/${plan.id}/rows/${plan.items[1]?.id}`, { lessonId: 'g11' });

    // A lesson of the KTP: its topic.
    const started = await call('POST', '/api/sessions', { classId: 'class-1a', lessonId: 'g11' });
    const { session } = SessionResponseSchema.parse(started.json());
    await call('POST', `/api/sessions/${session.id}/end`);
    let offer = SessionKtpResponseSchema.parse(
      (await call('GET', `/api/sessions/${session.id}/ktp`)).json(),
    );
    expect(offer.ktp).toMatchObject({ planId: plan.id, linked: true });
    expect(offer.ktp?.row?.topic).toBe('До и после');
    plan = KtpPlanSchema.parse((await call('GET', `/api/ktp/${plan.id}`)).json());
    expect(plan.items[1]?.heldAt?.slice(0, 10)).toBe(session.startedAt.slice(0, 10));
    expect(plan.done).toBe(0);

    plan = KtpPlanSchema.parse(
      (
        await call('PATCH', `/api/ktp/${plan.id}/rows/${plan.items[1]?.id}`, { isDone: true })
      ).json(),
    );
    expect(plan.done).toBe(1);
    expect(plan.items[1]?.doneAt).not.toBeNull();

    // A lesson not in the KTP: the first topic not done yet.
    const other = SessionResponseSchema.parse(
      (await call('POST', '/api/sessions', { classId: 'class-1a', lessonId: 'g15' })).json(),
    ).session;
    await call('POST', `/api/sessions/${other.id}/end`);
    offer = SessionKtpResponseSchema.parse(
      (await call('GET', `/api/sessions/${other.id}/ktp`)).json(),
    );
    expect(offer.ktp).toMatchObject({ linked: false });
    expect(offer.ktp?.row?.topic).toBe('Предыдущий и последующий');
  });

  it('counts changes against the file and the school’s allowance', async () => {
    let plan = await make();
    expect(plan.changes).toEqual({ base: 4, changed: 0, allowedPercent: 30 });
    const [a, b, c] = plan.items;
    await call('PATCH', `/api/ktp/${plan.id}/rows/${a?.id}`, { topic: 'Предыдущее и следующее' });
    await call('PATCH', `/api/ktp/${plan.id}/rows/${b?.id}`, { note: 'с карточками' });
    await call('DELETE', `/api/ktp/${plan.id}/rows/${c?.id}`);
    plan = KtpPlanSchema.parse(
      (
        await call('POST', `/api/ktp/${plan.id}/rows`, {
          afterId: a?.id,
          row: { topic: 'Новая тема' },
        })
      ).json(),
    );
    // The note does not count; the new topic stands second.
    expect(plan.items.map((i) => i.topic)).toEqual([
      'Предыдущее и следующее',
      'Новая тема',
      'До и после',
      'Повторение',
    ]);
    expect(plan.changes).toMatchObject({ base: 4, changed: 3 });

    // The school allows more: its administrator says so.
    const school = await call('PATCH', '/api/schools/school-demo', { ktpChangePercent: 80 });
    expect(school.statusCode).toBe(200);
    expect(SchoolDetailsResponseSchema.parse(school.json()).ktpChangePercent).toBe(80);
    plan = KtpPlanSchema.parse((await call('GET', `/api/ktp/${plan.id}`)).json());
    expect(plan.changes.allowedPercent).toBe(80);
  });
});
