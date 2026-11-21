import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileUploadResponseSchema,
  HomeLookupResponseSchema,
  HomeMeResponseSchema,
  JoinResponseSchema,
  SessionResponseSchema,
  StudentFilesResponseSchema,
} from '@sinf/shared';
import { schema } from '../src/db/index.js';
import { blobPath, receiveBlob } from '../src/services/student-files.js';
import { loginTeacher, testApp, type TestApp } from './helpers.js';

/** H12: "Мои работы" — a child's folder on the lesson server (ADR-015). */

let t: TestApp;
let cookie: string;

let sessionId: string | null = null;

beforeEach(async () => {
  // The teacher's computer: classroom computers are named there (ADR-014).
  t = await testApp({ CLASSROOM_MODE: '1' });
  cookie = await loginTeacher(t.app);
  sessionId = null;
});

afterEach(async () => {
  for (const id of t.app.sessions.liveSessionIds()) t.app.sessions.end(id);
  await t.close();
});

/** A child in a running lesson: the headers the lesson page sends with every file request. */
async function childInLesson(studentId: string, pc?: string): Promise<Record<string, string>> {
  if (!sessionId) {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie },
      payload: { classId: 'class-1a', lessonId: 'k10' },
    });
    sessionId = SessionResponseSchema.parse(created.json()).session.id;
  }
  const row = t.database.db
    .select()
    .from(schema.students)
    .all()
    .find((s) => s.id === studentId);
  if (!row) throw new Error('no student');
  const joined = await t.app.inject({
    method: 'POST',
    url: '/api/join',
    payload: { sessionId, studentId, code: row.codePublic.split('+'), ...(pc ? { pc } : {}) },
  });
  const { token } = JoinResponseSchema.parse(joined.json());
  return { 'x-session-id': sessionId ?? '', 'x-participant-token': token };
}

function put(headers: Record<string, string>, name: string, bytes: Buffer, base?: string) {
  const q = new URLSearchParams({ name, ...(base ? { base } : {}) });
  return t.app.inject({
    method: 'PUT',
    url: `/api/my/files?${q.toString()}`,
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
}

const list = async (headers: Record<string, string>) =>
  StudentFilesResponseSchema.parse(
    (await t.app.inject({ method: 'GET', url: '/api/my/files', headers })).json(),
  );

describe('the school’s limits (stage 5, A2)', () => {
  it('a lower quota and a smaller file, from the school’s rules', async () => {
    // The administrator lowers both: 2 MB a child, 1 MB a file.
    const patched = await t.app.inject({
      method: 'PATCH',
      url: '/api/schools/school-demo/settings',
      headers: { cookie },
      payload: { fileQuotaMb: 2, maxFileMb: 1 },
    });
    expect(patched.statusCode).toBe(200);
    const child = await childInLesson('student-01');
    const folder = await list(child);
    expect(folder).toMatchObject({ quotaBytes: 2 * 1024 * 1024, maxFileBytes: 1024 * 1024 });

    const big = await put(child, 'big.png', Buffer.alloc(1024 * 1024 + 1));
    expect([big.statusCode, big.json<{ error?: string }>().error]).toEqual([413, 'too_large']);
    expect((await put(child, 'a.png', Buffer.alloc(1024 * 1024))).statusCode).toBe(200);
    expect((await put(child, 'b.png', Buffer.alloc(900 * 1024))).statusCode).toBe(200);
    const full = await put(child, 'c.png', Buffer.alloc(200 * 1024));
    expect(full.json<{ error?: string }>().error).toBe('quota');
  });
});

describe('a child’s folder in a lesson', () => {
  it('keeps, lists, gives back and deletes a file', async () => {
    const child = await childInLesson('student-01');
    const bytes = Buffer.from('Мой первый документ');
    const res = await put(child, 'Сочинение.txt', bytes);
    expect(res.statusCode).toBe(200);
    const { file, conflictWith, unchanged } = FileUploadResponseSchema.parse(res.json());
    expect({ conflictWith, unchanged }).toEqual({ conflictWith: null, unchanged: false });
    expect(file).toMatchObject({ name: 'Сочинение.txt', size: bytes.length, origin: 'браузер' });

    const folder = await list(child);
    expect(folder.files.map((f) => f.name)).toEqual(['Сочинение.txt']);
    expect(folder.usedBytes).toBe(bytes.length);
    expect(folder.student.name).toBe('Алиев Тимур');

    const got = await t.app.inject({
      method: 'GET',
      url: `/api/my/files/${file.id}/content`,
      headers: child,
    });
    expect(got.rawPayload.equals(bytes)).toBe(true);
    expect(got.headers['content-disposition']).toContain('attachment');
    expect(got.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('Сочинение.txt')}`,
    );
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-security-policy']).toBe('sandbox');

    const after = await t.app.inject({
      method: 'DELETE',
      url: `/api/my/files/${file.id}`,
      headers: child,
    });
    expect(StudentFilesResponseSchema.parse(after.json()).files).toEqual([]);
    // Nobody names these bytes any more: they are gone from the disk too.
    expect(existsSync(blobPath(t.config.dataDir, file.sha256))).toBe(false);
  });

  it('names the classroom computer an upload came from', async () => {
    const child = await childInLesson('student-01', 'ПК-05');
    const { file } = FileUploadResponseSchema.parse(
      (await put(child, 'Рисунок.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).json(),
    );
    expect(file.origin).toBe('ПК-05');
  });

  it('keeps both versions when the file changed meanwhile, and nothing twice', async () => {
    const child = await childInLesson('student-01', 'ПК-05');
    const v1 = FileUploadResponseSchema.parse(
      (await put(child, 'Отчёт.docx', Buffer.from('v1'))).json(),
    ).file;
    // Saved again on top of v1: it simply replaces it, under the same name in another case.
    const v2 = FileUploadResponseSchema.parse(
      (await put(child, 'отчёт.DOCX', Buffer.from('v2'), v1.sha256)).json(),
    );
    expect(v2).toMatchObject({ conflictWith: null, unchanged: false });
    expect(v2.file.id).toBe(v1.id);
    // The same content again: nothing changes.
    expect(
      FileUploadResponseSchema.parse(
        (await put(child, 'Отчёт.docx', Buffer.from('v2'), v1.sha256)).json(),
      ).unchanged,
    ).toBe(true);
    // Made from v1 while v2 was saved elsewhere: kept beside it.
    const late = FileUploadResponseSchema.parse(
      (await put(child, 'Отчёт.docx', Buffer.from('v3'), v1.sha256)).json(),
    );
    expect(late.conflictWith).toBe('отчёт.DOCX');
    expect(late.file.name).toBe('Отчёт (копия ПК-05).docx');
    // A "new" file with a taken name is not allowed to overwrite it either.
    const fresh = FileUploadResponseSchema.parse(
      (await put(child, 'Отчёт.docx', Buffer.from('v4'))).json(),
    );
    expect(fresh.file.name).toBe('Отчёт (копия ПК-05 2).docx');
    expect((await list(child)).files).toHaveLength(3);
    // v1 is not named by anybody now.
    expect(existsSync(blobPath(t.config.dataDir, v1.sha256))).toBe(false);
  });

  it('refuses names and kinds a school computer must not get', async () => {
    const child = await childInLesson('student-01');
    const code = async (name: string) =>
      (await put(child, name, Buffer.from('x'))).json<{ error: string }>().error;
    expect(await code('virus.exe')).toBe('bad_name_extension');
    expect(await code('script.js')).toBe('bad_name_extension');
    expect(await code('macro.docm')).toBe('bad_name_extension');
    expect(await code('CON.txt')).toBe('bad_name_reserved');
    expect(await code('../../secret.txt')).toBe('bad_name_empty');
    expect(await code(`${'а'.repeat(130)}.txt`)).toBe('bad_name_long');
    // A name with forbidden characters is mended, not refused.
    const ok = FileUploadResponseSchema.parse(
      (await put(child, 'a:b*c?.txt', Buffer.from('x'))).json(),
    );
    expect(ok.file.name).toBe('a_b_c_.txt');
  });

  it('stops at the quota and at 50 MB without reading the file', async () => {
    const child = await childInLesson('student-01');
    t.database.db
      .insert(schema.studentFiles)
      .values({
        id: 'big',
        studentId: 'student-01',
        name: 'big.pdf',
        nameKey: 'big.pdf',
        size: 200 * 1024 * 1024 - 10,
        sha256: 'a'.repeat(64),
        updatedAt: new Date().toISOString(),
        origin: 'браузер',
      })
      .run();
    expect(
      (await put(child, 'one-more.txt', Buffer.alloc(100))).json<{ error?: string }>().error,
    ).toBe('quota');
    const tooBig = await t.app.inject({
      method: 'PUT',
      url: '/api/my/files?name=huge.pdf',
      headers: {
        ...child,
        'content-type': 'application/octet-stream',
        'content-length': String(51 * 1024 * 1024),
      },
      payload: Buffer.alloc(10),
    });
    expect(tooBig.statusCode).toBe(413);
  });

  it('refuses a body longer than it said', async () => {
    await expect(
      receiveBlob(t.config.dataDir, Readable.from([Buffer.alloc(100)]), 10),
    ).rejects.toMatchObject({ statusCode: 413 });
    await expect(
      receiveBlob(t.config.dataDir, Readable.from([Buffer.alloc(5)]), 10),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('shows a picture inline only when asked, and never a page', async () => {
    const child = await childInLesson('student-01');
    const png = FileUploadResponseSchema.parse(
      (await put(child, 'Рисунок.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).json(),
    ).file;
    const page = FileUploadResponseSchema.parse(
      (await put(child, 'page.html', Buffer.from('<script>alert(1)</script>'))).json(),
    ).file;
    const get = (id: string) =>
      t.app.inject({ method: 'GET', url: `/api/my/files/${id}/content?inline=1`, headers: child });
    const picture = await get(png.id);
    expect(picture.headers['content-type']).toBe('image/png');
    expect(picture.headers['content-disposition']).toMatch(/^inline/);
    const html = await get(page.id);
    expect(html.headers['content-type']).toBe('application/octet-stream');
    expect(html.headers['content-disposition']).toMatch(/^attachment/);
    expect(html.headers['content-security-policy']).toBe('sandbox');
  });

  it('lets nobody else in', async () => {
    const aliev = await childInLesson('student-01');
    const file = FileUploadResponseSchema.parse(
      (await put(aliev, 'Моё.txt', Buffer.from('x'))).json(),
    ).file;
    const karimova = await childInLesson('student-02');
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/my/files/${file.id}/content`,
          headers: karimova,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/my/files/${file.id}`, headers: karimova }))
        .statusCode,
    ).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/my/files' })).statusCode).toBe(401);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/my/files',
          headers: { 'x-session-id': aliev['x-session-id'] ?? '', 'x-participant-token': 'forged' },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('the teacher', () => {
  it('opens a child’s folder and collects the class’s works into a ZIP', async () => {
    const aliev = await childInLesson('student-01');
    const karimova = await childInLesson('student-02');
    await put(aliev, 'Рисунок.png', Buffer.from('aliev-png'));
    await put(karimova, 'Рисунок.png', Buffer.from('karimova-png'));
    await put(karimova, 'Текст.txt', Buffer.from('hello'));

    const folder = StudentFilesResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/students/student-02/files',
          headers: { cookie },
        })
      ).json(),
    );
    expect(folder.files.map((f) => f.name)).toEqual(['Рисунок.png', 'Текст.txt']);
    const one = await t.app.inject({
      method: 'GET',
      url: `/api/students/student-02/files/${folder.files[1]?.id}/content`,
      headers: { cookie },
    });
    expect(one.body).toBe('hello');

    const zip = await t.app.inject({
      method: 'GET',
      url: '/api/classes/class-1a/works.zip',
      headers: { cookie },
    });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(zip.rawPayload));
    expect(Object.keys(entries).sort()).toEqual([
      'Алиев Тимур/Рисунок.png',
      'Каримова Мадина/Рисунок.png',
      'Каримова Мадина/Текст.txt',
    ]);
    expect(strFromU8(entries['Каримова Мадина/Текст.txt'] ?? new Uint8Array())).toBe('hello');
  });

  it('sees no folder of a class that is not theirs', async () => {
    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'Чужой Учитель', email: 'other@example.com', password: 'parol12345' },
    });
    const c = reg.cookies.find((x) => x.name === 'sinf_teacher');
    const other = `${c?.name}=${c?.value}`;
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/students/student-01/files',
          headers: { cookie: other },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/classes/class-1a/works.zip',
          headers: { cookie: other },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('a child at home', () => {
  /** A grade-5 class: digit codes, the only ones allowed from home. */
  async function digitClass() {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: { cookie },
      payload: { name: '5Б', grade: 5 },
    });
    const cls = created.json<{ class: { id: string; homeCode: string | null } }>().class;
    expect(cls.homeCode).toMatch(/^\d{6}$/);
    await t.app.inject({
      method: 'POST',
      url: `/api/classes/${cls.id}/students`,
      headers: { cookie },
      payload: { students: [{ lastName: 'Юсупов', firstName: 'Сардор' }] },
    });
    const details = (
      await t.app.inject({ method: 'GET', url: `/api/classes/${cls.id}`, headers: { cookie } })
    ).json<{ students: { id: string; code: string[] }[] }>();
    return {
      code: cls.homeCode ?? '',
      student: details.students[0] as { id: string; code: string[] },
    };
  }

  const lookup = (classCode: string, ip = '10.0.0.1') =>
    t.app.inject({
      method: 'POST',
      url: '/api/my/lookup',
      payload: { classCode },
      remoteAddress: ip,
    });
  const login = (classCode: string, studentId: string, code: string[]) =>
    t.app.inject({ method: 'POST', url: '/api/my/login', payload: { classCode, studentId, code } });

  it('finds the class by its code, lets the child in with their own code, and shows their folder', async () => {
    const { code, student } = await digitClass();
    const found = HomeLookupResponseSchema.parse((await lookup(code)).json());
    expect(found.students.map((s) => s.lastName)).toEqual(['Юсупов']);

    const res = await login(code, student.id, student.code);
    expect(res.statusCode).toBe(200);
    expect(HomeMeResponseSchema.parse(res.json()).student.className).toBe('5Б');
    const c = res.cookies.find((x) => x.name === 'sinf_student');
    const home = { cookie: `${c?.name}=${c?.value}` };
    expect(
      StudentFilesResponseSchema.parse(
        (await t.app.inject({ method: 'GET', url: '/api/my/files', headers: home })).json(),
      ).student.id,
    ).toBe(student.id);
    // A forged cookie is nobody.
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/my/files',
          headers: { cookie: `sinf_student=${student.id}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('locks a child out after five wrong codes', async () => {
    const { code, student } = await digitClass();
    const wrong = student.code.map((d) => String((Number(d) + 1) % 10));
    for (let i = 0; i < 4; i += 1)
      expect((await login(code, student.id, wrong)).statusCode).toBe(401);
    expect((await login(code, student.id, wrong)).json<{ error?: string }>().error).toBe('locked');
    expect((await login(code, student.id, student.code)).statusCode).toBe(429);
  });

  it('does not let anyone go through class codes one by one', async () => {
    // Ten wrong codes from one address, and that address waits.
    for (let i = 0; i < 10; i += 1) expect((await lookup(String(100000 + i))).statusCode).toBe(404);
    expect((await lookup('100010')).statusCode).toBe(429);
    // Another address is not punished for it.
    expect((await lookup('100011', '10.0.0.2')).statusCode).toBe(404);
  });

  it('keeps picture-code classes at school', async () => {
    const cls = t.database.db
      .select()
      .from(schema.classes)
      .all()
      .find((c) => c.id === 'class-1a');
    expect(cls?.homeCode).toMatch(/^\d{6}$/);
    expect((await lookup(cls?.homeCode ?? '')).json<{ error?: string }>().error).toBe(
      'picture_codes',
    );
  });
});
