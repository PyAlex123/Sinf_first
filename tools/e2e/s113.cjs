// S1.13: итоги урока и журнал — g10 (тренажёры и викторина) и k10 (звёзды за рисунок), журнал
// класса, переключатель «звёзды → оценка» и выгрузка в Excel.
//
// Звёзды за тренажёры ученик отправляет тем же сообщением протокола, что и проигрыватель
// (`student.screen.done`), — решать девять тренажёров кликами для этого шага незачем.
const { chromium } = require('playwright');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
  });
  const teacher = await ctx.newPage();
  const errors = [];
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  teacher.on('dialog', (d) => void d.accept());

  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")', { timeout: 15000 });
  const me = await teacher.evaluate(async () => (await fetch('/api/me')).json());
  const classId = me.classes[0].id;
  const details = await teacher.evaluate(
    async (id) => (await fetch(`/api/classes/${id}`)).json(),
    classId,
  );

  async function startLesson(title) {
    await teacher.goto(`${BASE}/teacher`);
    await teacher.waitForSelector('h2:has-text("Уроки")', { timeout: 15000 });
    await teacher
      .locator('.lcard', { hasText: title })
      .locator('button:has-text("Начать урок")')
      .click();
    await teacher.waitForURL('**/teacher/session/**', { timeout: 15000 });
    await teacher.waitForTimeout(600);
    const code = (await teacher.locator('text=/Код урока: ?[0-9]{4}/').first().innerText()).match(
      /[0-9]{4}/,
    )[0];
    return { code, sessionId: teacher.url().split('/').pop() };
  }

  async function joinAs(i, code) {
    const who = details.students[i];
    const page = await (
      await browser.newContext({ viewport: { width: 1024, height: 768 } })
    ).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`ученик ${i + 1}: ${m.text()}`));
    await page.goto(`${BASE}/join?code=${code}`);
    await page.waitForSelector('.names button', { timeout: 15000 });
    const lookup = await page.evaluate(
      async (c) =>
        (
          await fetch('/api/join/lookup', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: c }),
          })
        ).json(),
      code,
    );
    await page.locator('.names button', { hasText: who.lastName }).first().click();
    await page.waitForSelector('.choice', { timeout: 8000 });
    for (const key of who.code) {
      await page.locator('.choice').nth(lookup.codePics.indexOf(key)).click();
      await page.waitForTimeout(120);
    }
    await page.waitForSelector('text=Начать', { timeout: 10000 });
    await page.locator('text=Начать').first().click();
    await page.waitForTimeout(300);
    return { page, name: `${who.lastName} ${who.firstName}` };
  }

  /** Same message the lesson player sends when a trainer is solved. */
  async function solve(student, sessionId, screens) {
    await student.page.evaluate(
      async ({ sessionId, screens }) => {
        const token = sessionStorage.getItem(`sinf.participant.${sessionId}`);
        const ws = new WebSocket(
          `ws://${location.host}/ws?session=${sessionId}&role=student&participant=${token}`,
        );
        await new Promise((r) => ws.addEventListener('open', r));
        for (const [index, stars] of screens) {
          ws.send(JSON.stringify({ v: 1, type: 'student.screen.done', index, stars }));
        }
        await new Promise((r) => setTimeout(r, 300));
        ws.close();
      },
      { sessionId, screens },
    );
  }

  async function endLesson(sessionId) {
    await teacher.locator('button:has-text("Завершить урок")').click();
    await teacher.waitForURL(`**/teacher/session/${sessionId}/results`, { timeout: 10000 });
    await teacher.waitForSelector('table', { timeout: 10000 });
  }

  // ---------- урок 1: g10, четверо из двадцати, тренажёры и один вопрос викторины
  const g10 = await startLesson('Предыдущий — последующий');
  const kids = [];
  for (let i = 0; i < 4; i++) kids.push(await joinAs(i, g10.code));
  await teacher.waitForTimeout(500);
  check('урок 1: четверо в уроке', (await teacher.locator('.tile').count()) === 4);

  // Алиев решает все тренажёры (16 ★), Каримова — часть (6 ★), третий — один, четвёртый — ничего.
  const ALL = [
    [10, 1],
    [11, 1],
    [12, 1],
    [13, 1],
    [14, 1],
    [15, 1],
    [17, 1],
    [18, 1],
    [19, 1],
    [20, 2],
    [21, 2],
    [22, 3],
  ];
  await solve(kids[0], g10.sessionId, ALL);
  await solve(kids[1], g10.sessionId, [
    [10, 1],
    [11, 1],
    [13, 1],
    [20, 2],
    [14, 1],
  ]);
  await solve(kids[2], g10.sessionId, [[22, 3]]);

  for (let i = 0; i < 4; i++) {
    await teacher.locator('button:has-text("Пропустить")').click();
    await teacher.waitForTimeout(250);
  }
  await kids[0].page.waitForSelector('.opt', { timeout: 8000 });
  await kids[0].page.locator('.opt').nth(1).click(); // верно
  await kids[1].page.locator('.opt').nth(1).click(); // верно
  await kids[2].page.locator('.opt').nth(0).click(); // мимо
  await kids[3].page.locator('.opt').nth(1).click(); // верно
  await teacher.waitForTimeout(800);

  const tEnd = Date.now();
  await endLesson(g10.sessionId);
  check('после «Завершить урок» сразу открылись итоги', true, `${Date.now() - tEnd} мс до таблицы`);
  const header1 = (await teacher.locator('.head').innerText()).replace(/\s+/g, ' ');
  check('итоги: пришли 4 из 20', /пришли 4 из 20/.test(header1), header1);
  const rows1 = await teacher.locator('tbody tr').count();
  check('итоги: весь класс на одном экране', rows1 === 20, `строк: ${rows1}`);
  const aliev = (await teacher.locator('tbody tr', { hasText: kids[0].name }).innerText()).replace(
    /\s+/g,
    ' ',
  );
  check('итоги: у Алиева 16 из 16 за тренажёры', /★ 16 из 16/.test(aliev), aliev);
  check('итоги: викторина — очки и «верно 1 из 1»', /верно 1 из 1/.test(aliev), aliev);
  const away = (await teacher.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ');
  check('итоги: отсутствующий помечен', /не был/.test(away), away);
  check(
    'итоги: в 1А нет колонки оценки',
    (await teacher.locator('th:has-text("Оценка")').count()) === 0,
  );
  // В g10 есть один «шаг» («расскажи соседу»), но рисунка не было: колонки и галереи нет.
  check(
    'итоги g10: без рисунка нет колонки «Рисунок» и галереи',
    (await teacher.locator('th:has-text("Рисунок")').count()) === 0 &&
      (await teacher.locator('.gallery').count()) === 0,
  );
  await teacher.screenshot({ path: `${S}/30-results-g10.png`, fullPage: true });

  // ---------- урок 2: k10, трое, звёзды за рисунок
  for (const k of kids) await k.page.context().close();
  const k10 = await startLesson('Радуга');
  const kids2 = [];
  for (let i = 0; i < 3; i++) kids2.push(await joinAs(i, k10.code));
  await teacher.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    await teacher.locator('button:has-text("Пропустить")').click();
    await teacher.waitForTimeout(250);
  }
  await teacher.waitForTimeout(500);
  for (const [i, stars] of [
    [0, 3],
    [1, 2],
  ]) {
    await teacher
      .locator('.tile')
      .nth(i)
      .locator('.star')
      .nth(stars - 1)
      .click();
    await teacher.waitForTimeout(100);
  }
  await teacher.waitForTimeout(500);
  await endLesson(k10.sessionId);
  check(
    'итоги k10: есть колонка «Рисунок»',
    (await teacher.locator('th:has-text("Рисунок")').count()) === 1,
  );
  const cards = await teacher.locator('.gallery li').count();
  check('галерея практики: карточка у каждого пришедшего', cards === 3, `карточек: ${cards}`);
  const gallery = (await teacher.locator('.gallery').innerText()).replace(/\s+/g, ' ');
  check(
    'галерея: звёзды и «снимка экрана нет»',
    /★★★/.test(gallery) && /Снимка экрана нет/.test(gallery),
    gallery.slice(0, 120),
  );
  check('галерея: у кого нет звёзд, так и сказано', /звёзд за рисунок нет/.test(gallery));
  await teacher.screenshot({ path: `${S}/31-results-k10.png`, fullPage: true });

  // ---------- журнал
  await teacher.locator('a:has-text("Журнал")').first().click();
  await teacher.waitForURL('**/teacher/journal/**');
  // Ждём именно журнал: таблица итогов ещё на экране в первый миг после перехода.
  await teacher.waitForSelector('thead th.day');
  const cols = await teacher.locator('thead th.day').count();
  check('журнал: два урока — две колонки', cols === 2, `колонок: ${cols}`);
  const jrows = await teacher.locator('tbody tr').count();
  check('журнал: 20 учеников', jrows === 20);
  const firstName = (await teacher.locator('tbody tr').first().locator('.who').innerText()).trim();
  check('журнал: по алфавиту', firstName.startsWith('Абдуллаев'), firstName);
  const alievRow = (
    await teacher.locator('tbody tr', { hasText: kids[0].name }).innerText()
  ).replace(/\s+/g, ' ');
  // g10: все тренажёры — 16 ★; k10: тренажёров не решал, за рисунок 3 ★.
  check('журнал: у Алиева ★ 16 и ★ 3', /★ 16 ★ 3/.test(alievRow), alievRow);
  const absents = await teacher.locator('td.absent').count();
  check('журнал: отсутствия отмечены «н»', absents === 16 + 17, `отметок: ${absents}`);
  await teacher.screenshot({ path: `${S}/32-journal.png`, fullPage: true });

  // ---------- Excel
  const [download] = await Promise.all([
    teacher.waitForEvent('download'),
    teacher.locator('a:has-text("Скачать Excel")').click(),
  ]);
  const file = join(S, 's113-journal.xlsx');
  await download.saveAs(file);
  const size = require('node:fs').statSync(file).size;
  check('Excel скачался', size > 1000, `${download.suggestedFilename()}, ${size} байт`);

  // ---------- оценки 2–5: включаем у класса
  await teacher.goto(`${BASE}/teacher/class/${classId}`);
  await teacher.waitForSelector('.switch input');
  await teacher.locator('.switch input').check();
  await teacher.waitForTimeout(500);
  check('переключатель включился', await teacher.locator('.switch input').isChecked());
  await teacher.screenshot({ path: `${S}/33-class-settings.png` });
  await teacher.goto(`${BASE}/teacher/journal/${classId}`);
  await teacher.waitForSelector('table');
  const graded = await teacher
    .locator('tbody tr', { hasText: kids[0].name })
    .locator('td.cell')
    .allInnerTexts();
  // g10: 16 из 16 и верный ответ — 100 % → 5; k10: 3 ★ за рисунок из 6 возможных — 50 % → 3.
  check('журнал с оценками: у Алиева 5 и 3', graded.join(' ') === '5 3', graded.join(' '));
  await teacher.screenshot({ path: `${S}/34-journal-grades.png`, fullPage: true });
  await teacher.goto(`${BASE}/teacher/session/${g10.sessionId}/results`);
  await teacher.waitForSelector('th:has-text("Оценка")');
  await teacher.screenshot({ path: `${S}/35-results-grades.png`, fullPage: true });
  const [download2] = await Promise.all([
    teacher.waitForEvent('download'),
    teacher
      .goto(`${BASE}/teacher/journal/${classId}`)
      .then(() => teacher.locator('a:has-text("Скачать Excel")').click()),
  ]);
  await download2.saveAs(join(S, 's113-journal-grades.xlsx'));

  // ---------- по-узбекски
  await teacher.locator('.lang button', { hasText: 'O‘zbekcha' }).click();
  await teacher.waitForTimeout(400);
  const uzHead = await teacher.locator('h1').innerText();
  check('журнал по-узбекски', /jurnali/.test(uzHead), uzHead);
  const uzAbsent = await teacher.locator('td.absent').first().innerText();
  check('отсутствие по-узбекски — «yo‘q»', uzAbsent.trim() === 'yo‘q', uzAbsent);
  await teacher.screenshot({ path: `${S}/36-journal-uz.png`, fullPage: true });
  await teacher.locator('.lang button', { hasText: 'Русский' }).click();

  // ---------- время ответа
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    await teacher.evaluate(async (id) => (await fetch(`/api/journal/${id}`)).json(), classId);
  }
  const journalMs = (Date.now() - t0) / 10;

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  console.log(`\nзамер: журнал класса отвечает в среднем за ${journalMs.toFixed(1)} мс`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
