// S1.15: учитель один проводит урок 10 с «живым» классом из 20 виртуальных учеников —
// вход, тренажёры, уходы со вкладки и руки, викторина, итоги, журнал и сброс демо.
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const teacher = await ctx.newPage();
  const errors = [];
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  teacher.on('dialog', (d) => void d.accept());

  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")', { timeout: 15000 });
  check(
    'у демо-класса есть кнопка «Демо»',
    (await teacher.locator('a:has-text("Демо")').count()) === 1,
  );

  await teacher
    .locator('.lcard', { hasText: 'Предыдущий — последующий' })
    .locator('button:has-text("Начать урок")')
    .click();
  await teacher.waitForURL('**/teacher/session/**', { timeout: 15000 });
  const sessionId = teacher.url().split('/').pop();

  // Проектор — во второй вкладке, как на уроке.
  const projector = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  projector.on('console', (m) => m.type() === 'error' && errors.push(`проектор: ${m.text()}`));
  await projector.goto(`${BASE}/present/${sessionId}`);

  // ---------- страница «Демо»: двадцать виртуальных учеников
  await teacher.locator('a:has-text("Виртуальные ученики")').click();
  await teacher.waitForURL('**/teacher/demo');
  await teacher.waitForSelector('input[type=number]');
  await teacher.fill('input[type=number]', '20');
  await teacher.locator('button:has-text("Добавить в урок")').click();
  await teacher.waitForSelector('text=Добавлено');
  check('страница «Демо»: 20 из 20', /20 из 20/.test(await teacher.locator('.now').innerText()));
  await teacher.screenshot({ path: `${S}/40-demo-page.png`, fullPage: true });

  await teacher.locator('a:has-text("К панели урока")').click();
  await teacher.waitForSelector('.tiles', { timeout: 15000 }).catch(() => undefined);
  await wait(5000);
  const early = await teacher.locator('.tile').count();
  check('входят не разом, а по одному', early > 0 && early < 20, `через 5 с вошли ${early}`);
  await wait(17000);
  const tiles = await teacher.locator('.tile').count();
  const badges = await teacher.locator('.tile .virt').count();
  check('через 20 секунд в уроке весь класс', tiles === 20, `плиток: ${tiles}`);
  check('у каждого значок «вирт.»', badges === 20, `значков: ${badges}`);
  const online = await teacher.locator('.tile:not(.offline)').count();
  check('все в сети', online === 20, `в сети: ${online}`);

  // ---------- практика в свободном режиме на демо-скорости ×10
  await teacher.locator('button:has-text("×1")').click();
  await teacher.locator('button:has-text("Свободно")').click();
  for (let i = 0; i < 3; i++) {
    await teacher.locator('button:has-text("Пропустить")').click();
    await wait(250);
  }
  await wait(25000);
  const stars = await teacher.locator('.tile .tmeta .stars').allInnerTexts();
  const counts = stars.map((s) => Number((s.match(/\d+/) ?? ['0'])[0]));
  const withStars = counts.filter((n) => n > 0).length;
  check('на практике звёзды у большинства', withStars >= 15, `со звёздами ${withStars} из 20`);
  check('звёзд у всех разное число', new Set(counts).size > 3, counts.join(','));
  const screens = new Set(
    (await teacher.locator('.tile .tmeta span:first-child').allInnerTexts()).map((s) => s.trim()),
  );
  check('ученики на разных экранах', screens.size > 1, [...screens].join(' | '));
  const flags = await teacher.locator('.tile .flag.away, .tile .flag.hand').count();
  check('кто-то уходил со вкладки или поднимал руку', flags > 0, `отметок на плитках: ${flags}`);
  await teacher.screenshot({ path: `${S}/41-session-virtual.png`, fullPage: true });

  // ---------- викторина: отвечают сами
  // Викторина идёт в настоящем времени, а этап на ×10 кончается за 30 секунд и уносит её с собой
  // (так устроено с S1.12): перед викториной скорость возвращаем.
  await teacher.locator('button:has-text("×10")').click();
  await teacher.locator('button:has-text("Пропустить")').click();
  await projector.waitForSelector('.quiz', { timeout: 10000 });
  let allAnswered = 0;
  for (let q = 0; q < 6; q++) {
    await projector.waitForSelector('.right', { timeout: 25000 }).catch(() => undefined);
    const shown = await projector.locator('.right').count();
    if (shown) allAnswered++;
    if (q === 0) await projector.screenshot({ path: `${S}/42-quiz-virtual.png` });
    await teacher.locator('button:has-text("Дальше")').first().click();
    await wait(300);
    await teacher.locator('button:has-text("Дальше")').first().click();
    await wait(300);
  }
  check(
    'на все 6 вопросов класс ответил до конца времени',
    allAnswered === 6,
    `${allAnswered} из 6`,
  );
  await projector.waitForSelector('.podium', { timeout: 5000 }).catch(() => undefined);
  const podium = (
    await projector
      .locator('.podium')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  check('на пьедестале виртуальные с пометкой', /вирт\./.test(podium), podium);
  await projector.screenshot({ path: `${S}/43-podium-virtual.png` });

  // ---------- итоги и журнал
  await teacher.locator('button:has-text("Завершить урок")').click();
  await teacher.waitForURL(`**/teacher/session/${sessionId}/results`, { timeout: 10000 });
  await teacher.waitForSelector('tbody tr');
  const header = (await teacher.locator('.head').innerText()).replace(/\s+/g, ' ');
  check('итоги: 20 пришли, настоящие 20 — отсутствуют', /пришли 20 из 40/.test(header), header);
  const virtRows = await teacher.locator('tbody tr', { hasText: 'вирт.' }).count();
  check('итоги: 20 строк со значком', virtRows === 20, `строк: ${virtRows}`);
  const quizCells = await teacher.locator('tbody tr', { hasText: 'вирт.' }).allInnerTexts();
  const right = quizCells.map((r) => Number((r.match(/верно (\d+) из 6/) ?? [0, 0])[1]));
  const share = right.reduce((a, b) => a + b, 0) / (6 * 20);
  check('викторина: около 70 % верных', share > 0.5 && share < 0.9, `${Math.round(share * 100)} %`);
  await teacher.screenshot({ path: `${S}/44-results-virtual.png`, fullPage: true });

  await teacher.locator('a:has-text("Журнал")').first().click();
  await teacher.waitForSelector('thead th.day');
  const journalVirt = await teacher.locator('tbody .who', { hasText: 'вирт.' }).count();
  check('журнал: виртуальные со значком', journalVirt === 20, `строк: ${journalVirt}`);

  // ---------- сброс демо
  await teacher.goto(`${BASE}/teacher/demo`);
  await teacher.locator('button:has-text("Сбросить демо")').click();
  await teacher.waitForSelector('text=Демо сброшено');
  await teacher.goto(`${BASE}/teacher/journal/class-1a`);
  await teacher.waitForSelector('h1');
  check(
    'после сброса журнал пуст',
    (await teacher.locator('text=Пока нет проведённых уроков').count()) === 1,
  );

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
