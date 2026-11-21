// H16 (STAGE3.md): the practice in Word with the file checked automatically, the browser path from
// start to end. The sample lesson "Образец: Оформи документ": the template is in the child's
// folder, the child downloads it and hands in the finished file, the check-list and the teacher's
// tile show the score, leaving the practice hands the work in, the teacher marks the manual
// criteria in the results and downloads the file handed in.
const { chromium } = require('playwright');
const { mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
mkdirSync(S, { recursive: true });
const ROOT = join(__dirname, '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'content/proba-praktiki/templates/oformi-dokument.docx'));
const DONE = readFileSync(
  join(ROOT, 'apps/server/test/fixtures/practice/oformi-dokument-done.docx'),
);
const HALF = readFileSync(
  join(ROOT, 'apps/server/test/fixtures/practice/oformi-dokument-half.docx'),
);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const teacherCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const teacher = await teacherCtx.newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  teacher.on('dialog', (d) => void d.accept());
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")');
  check(
    'урок-образец есть в списке уроков',
    (await teacher.locator('text=Образец: Оформи документ').count()) > 0,
  );

  // Class 1А turns stars into grades: the practice's points go into the suggested grade.
  const { sessionId, tokens } = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    await json('PATCH', '/api/classes/class-1a/settings', { starsToGrade: true });
    const details = await json('GET', '/api/classes/class-1a');
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'proba-dokument',
    });
    const tokens = {};
    for (const last of ['Алиев', 'Каримова']) {
      const s = details.students.find((x) => x.lastName === last);
      const joined = await json('POST', '/api/join', {
        sessionId: session.id,
        studentId: s.id,
        code: s.code,
      });
      tokens[last] = { token: joined.token, id: s.id };
    }
    return { sessionId: session.id, tokens };
  });

  await teacher.goto(`${BASE}/teacher/session/${sessionId}`);
  await teacher.waitForSelector('button:has-text("Пропустить")');

  const kidCtx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
  });
  const kid = await kidCtx.newPage();
  kid.on('console', (m) => m.type() === 'error' && errors.push(`ученик: ${m.text()}`));
  await kid.goto(`${BASE}/`);
  await kid.evaluate(
    ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
    [sessionId, tokens['Алиев'].token],
  );
  await kid.goto(`${BASE}/s/${sessionId}`);
  await kid.waitForSelector('button:has-text("Начать")', { timeout: 8000 });
  await kid.locator('button:has-text("Начать")').first().click();
  check('до практики карточки практики нет', (await kid.locator('section.practice').count()) === 0);

  // Greeting → task → practice.
  await teacher.locator('button:has-text("Пропустить")').click();
  await teacher.waitForTimeout(300);
  await teacher.locator('button:has-text("Пропустить")').click();
  await kid.waitForSelector('section.practice', { timeout: 8000 });
  check('на практике у ученика карточка с заданием', true);
  check(
    'в карточке — чек-лист из семи критериев, два ручных',
    (await kid.locator('section.practice li[data-criterion]').count()) === 7 &&
      (await kid.locator('section.practice li.manual').count()) === 2,
  );

  // The template is in the child's folder from the login on.
  const [dl] = await Promise.all([
    kid.waitForEvent('download'),
    kid.locator('section.practice button:has-text("Скачать задание")').click(),
  ]);
  const got = readFileSync(await dl.path());
  check('«Скачать задание» отдаёт шаблон', got.equals(TEMPLATE), `${got.length} байт`);

  // Half done first, under the name the browser gave the download.
  await kid
    .locator('section.practice input[type=file]')
    .setInputFiles({ name: 'Оформи документ (1).docx', mimeType: DOCX, buffer: HALF });
  await kid.waitForSelector('section.practice [data-score]:has-text("3 из 5")', { timeout: 8000 });
  check('после сдачи половины — «3 из 5»', true);
  check(
    'в чек-листе отмечено, что получилось и что нет',
    (await kid.locator('section.practice li.pass').count()) === 3 &&
      (await kid.locator('section.practice li.fail').count()) === 2,
  );
  await teacher.waitForSelector('[data-check="3/5"]', { timeout: 8000 });
  check('на плитке учителя — «Практика: 3/5»', true);

  // Then all of it.
  await kid
    .locator('section.practice input[type=file]')
    .setInputFiles({ name: 'Оформи документ.docx', mimeType: DOCX, buffer: DONE });
  await kid.waitForSelector('section.practice [data-score]:has-text("5 из 5")', { timeout: 8000 });
  await teacher.waitForSelector('[data-check="5/5"]', { timeout: 8000 });
  check('готовый файл — «5 из 5» у ученика и у учителя', true);
  await kid.screenshot({ path: `${S}/161-h16-child.png` });
  await teacher.screenshot({ path: `${S}/162-h16-tile.png` });

  // The folder keeps one file under the practice's name: the download's "(1)" did not stick.
  const names = await kid.evaluate(
    async ([id, tk]) =>
      (
        await fetch('/api/my/files', {
          headers: { 'x-session-id': id, 'x-participant-token': tk },
        }).then((r) => r.json())
      ).files.map((f) => f.name),
    [sessionId, tokens['Алиев'].token],
  );
  check(
    'в папке один файл практики, под своим именем',
    JSON.stringify(names) === JSON.stringify(['Оформи документ.docx']),
    JSON.stringify(names),
  );

  // Leaving the practice hands the work in; a change afterwards does not count.
  await teacher.locator('button:has-text("Пропустить")').click();
  await kid.waitForSelector('section.practice', { state: 'detached', timeout: 8000 });
  check('после практики карточка исчезает', true);
  await teacher.waitForTimeout(31_000);
  const late = await kid.evaluate(
    async ([id, tk, bytes]) => {
      const list = await fetch('/api/my/files', {
        headers: { 'x-session-id': id, 'x-participant-token': tk },
      }).then((r) => r.json());
      const there = list.files.find((f) => f.name === 'Оформи документ.docx');
      const r = await fetch(
        `/api/my/files?name=${encodeURIComponent('Оформи документ.docx')}&base=${there.sha256}`,
        {
          method: 'PUT',
          headers: {
            'x-session-id': id,
            'x-participant-token': tk,
            'content-type': 'application/octet-stream',
          },
          body: new Uint8Array(bytes),
        },
      );
      return r.status;
    },
    [sessionId, tokens['Алиев'].token, [...HALF]],
  );
  check('после сдачи ребёнок ещё может сохранять', late === 200);

  // The lesson ends; the results.
  await teacher.locator('button:has-text("Завершить урок")').click();
  await teacher.waitForTimeout(500);
  await teacher.goto(`${BASE}/teacher/session/${sessionId}/results`);
  await teacher.waitForSelector('section[aria-label="Работы практики"]', { timeout: 8000 });
  const aliev = tokens['Алиев'].id;
  const cell = await teacher.locator(`td[data-practice="${aliev}"]`).innerText();
  check('в таблице итогов — баллы практики сданной версии', cell.includes('10 из 14'), cell);
  const work = teacher.locator(`li[data-work="${aliev}"]`);
  check('работа помечена «сдано»', (await work.locator('text=сдано').count()) === 1);
  const offered = await teacher.locator('tr:has-text("Алиев") .pg.offered').innerText();
  check('предложенная оценка — 4 (10 из 14 = 71 %)', offered.trim() === '4', offered);

  // The teacher marks both manual criteria: 14 of 14, the grade offered becomes a 5.
  await work.locator('li:has-text("Без ошибок") button[data-mark="yes"]').click();
  await teacher.waitForSelector(`li[data-work="${aliev}"] [data-points="12/14"]`);
  await work.locator('li:has-text("Аккуратно") button[data-mark="yes"]').click();
  await teacher.waitForSelector(`li[data-work="${aliev}"] [data-points="14/14"]`);
  const offered5 = await teacher.locator('tr:has-text("Алиев") .pg.offered').innerText();
  check('ручные отметки входят в оценку: 14 из 14 → 5', offered5.trim() === '5', offered5);

  // The file handed in is the finished one, not the later half.
  const handed = await teacher.evaluate(
    async ([id, studentId]) => {
      const r = await fetch(`/api/sessions/${id}/practice/${studentId}/file`);
      return { status: r.status, bytes: [...new Uint8Array(await r.arrayBuffer())] };
    },
    [sessionId, aliev],
  );
  check(
    'учитель скачивает сданную версию, а не позднюю',
    handed.status === 200 && Buffer.from(handed.bytes).equals(DONE),
    `${handed.bytes.length} байт`,
  );
  const other = await teacher.locator(`li[data-work="${tokens['Каримова'].id}"]`).innerText();
  check('у не сохранившей — «Файл не сохранялся»', other.includes('Файл не сохранялся'));
  await teacher.screenshot({ path: `${S}/163-h16-results.png`, fullPage: true });

  // Put the class back as it was for the other scenarios.
  await teacher.evaluate(() =>
    fetch('/api/classes/class-1a/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starsToGrade: false }),
    }),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
