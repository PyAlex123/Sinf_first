// S1.11: практика в Paint на уроке k10 «Радуга» — шаги у ученика, прогресс и звёзды у учителя.
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const HOW_MANY = 4;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const teacher = await ctx.newPage();
  const errors = [];
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));

  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")', { timeout: 15000 });

  // урок кружка: «Радуга», 16 шагов практики
  await teacher
    .locator('.lcard', { hasText: 'Радуга' })
    .locator('button:has-text("Начать урок")')
    .click();
  await teacher.waitForURL('**/teacher/session/**', { timeout: 15000 });
  await teacher.waitForTimeout(600);
  const code = (await teacher.locator('text=/Код урока: ?[0-9]{4}/').first().innerText()).match(
    /[0-9]{4}/,
  )[0];

  const me = await teacher.evaluate(async () => (await fetch('/api/me')).json());
  const classId = me.classes[0].id;
  const details = await teacher.evaluate(
    async (id) => (await fetch(`/api/classes/${id}`)).json(),
    classId,
  );

  const students = [];
  for (let i = 0; i < HOW_MANY; i++) {
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
    await page.waitForTimeout(400);
    students.push(page);
  }
  await teacher.waitForTimeout(600);
  check(
    'класс в уроке',
    (await teacher.locator('.tile').count()) === HOW_MANY,
    `плиток: ${await teacher.locator('.tile').count()}`,
  );

  // --- до практики звёзд за рисунок нет
  check('до практики звёзды не предлагаются', (await teacher.locator('.give').count()) === 0);

  // --- учитель доводит урок до практики
  for (let i = 0; i < 3; i++) {
    await teacher.locator('button:has-text("Пропустить")').click();
    await teacher.waitForTimeout(250);
  }
  await teacher.waitForTimeout(600);
  const stageName = await teacher
    .locator('.timer .stage')
    .first()
    .innerText()
    .catch(() => '');
  check('идёт этап практики', /практик/i.test(stageName), stageName.replace(/\s+/g, ' ').trim());
  check(
    'на плитках появились звёзды за рисунок',
    (await teacher.locator('.give').count()) === HOW_MANY,
  );

  // --- ученики отмечают шаги: первый три, второй один и зовёт на помощь
  const next = async (page) => {
    await page.locator('.nb.go2').click();
    await page.waitForTimeout(250);
  };
  // Практика начинается с пояснений; шаги идут дальше, ученик листает до них сам.
  const toFirstStep = async (page) => {
    for (let i = 0; i < 12; i++) {
      if ((await page.locator('.did').count()) > 0) return;
      await next(page);
    }
    throw new Error('не дошёл до шага');
  };
  const doStep = async (page) => {
    await page.waitForSelector('.did', { timeout: 8000 });
    await page.locator('.did').click();
    await page.waitForTimeout(200);
  };
  await toFirstStep(students[0]);
  for (let i = 0; i < 3; i++) {
    await doStep(students[0]);
    if (i < 2) await next(students[0]);
  }
  await toFirstStep(students[1]);
  await doStep(students[1]);
  await students[1].locator('.help').click();
  await teacher.waitForTimeout(800);

  const tileText = async (i) =>
    (await teacher.locator('.tile').nth(i).innerText()).replace(/\s+/g, ' ').trim();
  const t0text = await tileText(0);
  const t1text = await tileText(1);
  check('учитель видит, кто на каком шаге', /шаг 3 из 16/.test(t0text), t0text);
  check('учитель видит, сколько шагов сделано', /шагов: 3 из 16/.test(t0text));
  check(
    'второй ученик — на первом шаге и зовёт на помощь',
    /шаг 1 из 16/.test(t1text) && /Поднял руку|рука/i.test(t1text),
    t1text,
  );

  // --- кнопка на экране ученика поменялась
  const didText = (await students[0].locator('.did').innerText()).trim();
  check('ученик видит, что шаг отмечен', /Шаг сделан/.test(didText), didText);

  // --- вторая кнопка руки на шаге не нужна
  check('на шаге одна кнопка помощи', (await students[0].locator('.hand').count()) === 0);

  // --- снимки
  await teacher
    .locator('.tile')
    .nth(0)
    .screenshot({ path: `${S}/20-tile-steps.png` });
  await students[0].screenshot({ path: `${S}/21-student-step.png` });
  // Телефон — та же вкладка ученика: вход уже сделан, второй контекст его не унаследует.
  // Полный экран держит размер окна, поэтому сначала выходим из него.
  await students[0].evaluate(() => document.exitFullscreen?.().catch(() => undefined));
  await students[0].waitForTimeout(400);
  await students[0].setViewportSize({ width: 390, height: 844 });
  await students[0].waitForTimeout(600);
  await students[0].screenshot({ path: `${S}/22-student-step-phone.png` });
  await students[0].setViewportSize({ width: 1024, height: 768 });
  await students[0].waitForTimeout(400);

  // --- учитель выставляет звёзды всем: замер
  const t0 = Date.now();
  for (let i = 0; i < HOW_MANY; i++) {
    const stars = [3, 2, 3, 1][i] ?? 2;
    await teacher
      .locator('.tile')
      .nth(i)
      .locator('.star')
      .nth(stars - 1)
      .click();
    await teacher.waitForTimeout(80);
  }
  const ms = Date.now() - t0;
  await teacher.waitForTimeout(500);
  const given = await teacher.locator('.star.on').count();
  check('звёзды за рисунок выставлены всем', given === 3 + 2 + 3 + 1, `подсвечено звёзд: ${given}`);
  check(
    'на класс уходит меньше минуты',
    ms < 60000,
    `${HOW_MANY} учеников за ${ms} мс, ${Math.round(ms / HOW_MANY)} мс на ученика`,
  );

  // --- звёзды можно снять
  await teacher.locator('.tile').nth(3).locator('.star').nth(0).click();
  await teacher.waitForTimeout(400);
  const afterClear = await teacher.locator('.tile').nth(3).locator('.star.on').count();
  check('повторное нажатие снимает звёзды', afterClear === 0, `осталось: ${afterClear}`);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  console.log(`\nзамер: ${HOW_MANY} учеников, ${ms} мс на всех`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
