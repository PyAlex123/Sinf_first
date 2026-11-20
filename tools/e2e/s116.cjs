// S1.16: пробный показ по docs/demo-script.md — шаг за шагом, как его проведёт автор:
// сброс демо, g10 с двумя живыми и 18 виртуальными учениками, презентация, «Внимание!», практика,
// викторина, итоги, журнал, Excel, затем k10 с шагами Paint и звёздами за рисунок.
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LIVE = ['Алиев', 'Каримова'];

(async () => {
  const started = Date.now();
  const browser = await chromium.launch();
  const tctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
  });
  const teacher = await tctx.newPage();
  const errors = [];
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  teacher.on('dialog', (d) => void d.accept());
  const button = (text) => teacher.locator(`button:has-text("${text}")`).first();

  // ---------- чек-лист: вход и сброс демо
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")', { timeout: 15000 });
  await teacher.locator('a:has-text("Демо")').click();
  await button('Сбросить демо').click();
  await teacher.waitForSelector('text=Демо сброшено');
  check('чек-лист: демо сброшено', true);
  const details = await teacher.evaluate(async () => (await fetch('/api/classes/class-1a')).json());

  async function startLesson(title) {
    await teacher.goto(`${BASE}/teacher`);
    await teacher.waitForSelector('h2:has-text("Уроки")');
    await teacher
      .locator('.lcard', { hasText: title })
      .locator('button:has-text("Начать урок")')
      .click();
    await teacher.waitForURL('**/teacher/session/**', { timeout: 15000 });
    await wait(500);
    return teacher.url().split('/').pop();
  }

  /** A live student: scans the QR (the projector's link), types nothing but finds the name and two pictures. */
  async function liveStudent(lastName, joinUrl) {
    const who = details.students.find((s) => s.lastName === lastName);
    const page = await (
      await browser.newContext({ viewport: { width: 390, height: 844 } })
    ).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${lastName}: ${m.text()}`));
    await page.goto(joinUrl);
    await page.waitForSelector('.names button', { timeout: 15000 });
    const code = new URL(joinUrl).searchParams.get('code');
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
    await page.locator('.names button', { hasText: lastName }).first().click();
    await page.waitForSelector('.choice');
    for (const key of who.code) {
      await page.locator('.choice').nth(lookup.codePics.indexOf(key)).click();
      await wait(120);
    }
    await page.waitForSelector('text=Начать', { timeout: 10000 });
    await page.locator('text=Начать').first().click();
    await wait(300);
    return page;
  }

  /** The link the projector's QR holds: the lesson code from the teacher's header. */
  async function joinLink() {
    const code = (await teacher.locator('.joincode b').innerText()).trim();
    const shown = await projector
      .waitForFunction((c) => document.body.innerText.includes(c), code, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check('проектор показывает тот же код', shown, code);
    return `${BASE}/join?code=${code}`;
  }

  async function addVirtual(n) {
    await teacher.locator('a:has-text("Виртуальные ученики")').click();
    await teacher.waitForSelector('input[type=number]');
    await teacher.fill('input[type=number]', String(n));
    await button('Добавить в урок').click();
    await teacher.waitForSelector('text=Добавлено');
    await teacher.locator('a:has-text("К панели урока")').click();
    await teacher.waitForSelector('.tiles');
  }

  // ---------- 0:00 урок g10, проектор, живые ученики
  const g10 = await startLesson('Предыдущий — последующий');
  const projector = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  projector.on('console', (m) => m.type() === 'error' && errors.push(`проектор: ${m.text()}`));
  await projector.goto(`${BASE}/present/${g10}`);
  await projector.waitForSelector('svg, canvas, img', { timeout: 10000 }).catch(() => undefined);
  const joinUrl = await joinLink();
  check('проектор: код урока и QR', /code=\d{4}$/.test(joinUrl), joinUrl);
  const kids = [];
  for (const name of LIVE) kids.push(await liveStudent(name, joinUrl));
  await wait(600);
  const joined = (await projector.innerText('body')).match(/Вошли: (\d+)/)?.[1];
  check('проектор: «Вошли: 2»', joined === '2', `вошли: ${joined}`);
  await projector.screenshot({ path: `${S}/50-show-projector-code.png` });

  // ---------- 1:00 виртуальные
  await addVirtual(18);
  await wait(21000);
  check('класс из 20 за 20 секунд', (await teacher.locator('.tile').count()) === 20);

  // ---------- 2:00 презентация и «Внимание!»
  await button('Презентация').click();
  const before = await kids[0].locator('body').innerText();
  const t0 = Date.now();
  await teacher.keyboard.press('ArrowRight');
  await kids[0].waitForFunction((b) => document.body.innerText !== b, before, { timeout: 2000 });
  check('слайд у ученика сменился', true, `${Date.now() - t0} мс`);
  await button('Внимание всем').click();
  await kids[0].waitForSelector('text=Смотрите на учителя', { timeout: 2000 });
  check('«Внимание!» закрыло экран ученика', true);
  await kids[1].screenshot({ path: `${S}/51-show-attention.png` });
  await button('Снять у всех').click();
  await kids[0].waitForSelector('text=Смотрите на учителя', { state: 'detached', timeout: 2000 });

  // ---------- 3:30 практика
  for (let i = 0; i < 3; i++) {
    await button('Пропустить').click();
    await wait(250);
  }
  await button('Свободно').click();
  await button('×1').click();
  await wait(15000);
  const stars = (await teacher.locator('.tile .tmeta .stars').allInnerTexts()).map((s) =>
    Number((s.match(/\d+/) ?? ['0'])[0]),
  );
  check('практика: звёзды растут', stars.filter((n) => n > 0).length >= 12, stars.join(','));
  await teacher.screenshot({ path: `${S}/52-show-practice.png` });

  // ---------- 5:30 викторина
  await button('×10').click();
  await button('Пропустить').click();
  await projector.waitForSelector('.quiz', { timeout: 10000 });
  for (const kid of kids) await kid.locator('.opt').nth(1).click();
  await projector.waitForSelector('.right', { timeout: 20000 });
  check('викторина: ответ показан, когда ответили все', true);
  await projector.screenshot({ path: `${S}/53-show-quiz.png` });
  for (let i = 0; i < 2; i++) {
    await button('Дальше').click();
    await wait(300);
  }
  check(
    'викторина: второй вопрос',
    /2 из 6/.test(
      await projector
        .locator('.qnum')
        .innerText()
        .catch(() => ''),
    ),
  );
  await button('Завершить викторину').click();
  await wait(400);

  // ---------- 7:30 итоги, журнал, Excel
  await button('Завершить урок').click();
  await teacher.waitForURL(`**/teacher/session/${g10}/results`);
  await teacher.waitForSelector('tbody tr');
  const aliev = (await teacher.locator('tbody tr', { hasText: 'Алиев Тимур' }).innerText()).replace(
    /\s+/g,
    ' ',
  );
  check('итоги: живой ученик с ответом викторины', /верно 1 из/.test(aliev), aliev);
  await teacher.locator('a:has-text("Журнал")').first().click();
  await teacher.waitForSelector('thead th.day');
  const [download] = await Promise.all([
    teacher.waitForEvent('download'),
    teacher.locator('a:has-text("Скачать Excel")').click(),
  ]);
  check(
    'Excel скачан',
    download.suggestedFilename() === 'zhurnal-1A.xlsx',
    download.suggestedFilename(),
  );

  // ---------- 8:30 k10: шаги Paint
  for (const kid of kids) await kid.context().close();
  const k10 = await startLesson('Радуга');
  await projector.goto(`${BASE}/present/${k10}`);
  const joinUrl2 = await joinLink();
  const painter = await liveStudent('Алиев', joinUrl2);
  await addVirtual(12);
  for (let i = 0; i < 3; i++) {
    await button('Пропустить').click();
    await wait(250);
  }
  await button('Презентация').click();
  await wait(400);
  // Practice opens with explanations; the teacher flips on to "Шаг 1".
  for (let i = 0; i < 15 && (await painter.locator('.did').count()) === 0; i++) {
    await teacher.keyboard.press('ArrowRight');
    await wait(300);
  }
  await painter.locator('button:has-text("Я сделал этот шаг")').click();
  await wait(500);
  const tile = teacher.locator('.tile', { hasText: 'Алиев Тимур' });
  check('шаг Paint виден на плитке', /шагов: 1 из 16/.test(await tile.innerText()));
  await tile.locator('.star').nth(2).click();
  await wait(300);
  await button('Завершить урок').click();
  await teacher.waitForURL(`**/teacher/session/${k10}/results`);
  await teacher.waitForSelector('.gallery');
  const card = (
    await teacher.locator('.gallery li', { hasText: 'Алиев Тимур' }).innerText()
  ).replace(/\s+/g, ' ');
  check('галерея: три звезды за рисунок', /★★★/.test(card), card);
  await teacher.screenshot({ path: `${S}/54-show-gallery.png`, fullPage: true });

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  console.log(`\nпробный показ занял ${Math.round((Date.now() - started) / 1000)} с`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
