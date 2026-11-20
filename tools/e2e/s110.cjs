const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const ok = [];
const bad = [];
const check = (name, pass, extra = '') =>
  (pass ? ok : bad).push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const teacher = await ctx.newPage();
  const errors = [];
  for (const p of [teacher]) p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // --- teacher logs in and starts a lesson
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForURL('**/teacher', { timeout: 10000 });
  await teacher.click('text=Начать урок >> nth=0');
  await teacher.waitForURL('**/teacher/session/**', { timeout: 10000 });
  const code = (await teacher.locator('text=/Код урока: ?\\d{4}/').first().innerText()).match(
    /\d{4}/,
  )[0];
  console.log('код урока:', code);

  // --- two students join with their real picture codes (read through the teacher's own session)
  const me = await teacher.evaluate(async () => (await fetch('/api/me')).json());
  const classId = me.classes[0].id;
  const details = await teacher.evaluate(
    async (id) => (await fetch(`/api/classes/${id}`)).json(),
    classId,
  );
  const students = [];
  for (let i = 0; i < 2; i++) {
    const who = details.students[i];
    const page = await (
      await browser.newContext({ viewport: { width: 1024, height: 768 } })
    ).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`ученик: ${m.text()}`));
    await page.goto(`${BASE}/join?code=${code}`);
    await page.waitForSelector('.names button', { timeout: 10000 });
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
    await page.waitForSelector('.choice', { timeout: 5000 });
    for (const key of who.code) {
      await page.locator('.choice').nth(lookup.codePics.indexOf(key)).click();
      await page.waitForTimeout(120);
    }
    await page.waitForSelector('text=Начать', { timeout: 8000 });
    await page.locator('text=Начать').first().click();
    await page.waitForTimeout(500);
    students.push(page);
  }
  await teacher.waitForTimeout(800);
  const tiles = teacher.locator('.tile');
  check(
    'двое учеников видны на плитках',
    (await tiles.count()) >= 2,
    `плиток: ${await tiles.count()}`,
  );

  // --- lock ONE student from his tile
  const lockBtn = (i) => teacher.locator(`.tile >> nth=${i}`).locator('.act').first();
  await lockBtn(0).click();
  await teacher.waitForTimeout(500);
  const locked0 = await students[0]
    .locator('.lock')
    .isVisible()
    .catch(() => false);
  const locked1 = await students[1]
    .locator('.lock')
    .isVisible()
    .catch(() => false);
  check('«Внимание» одному закрывает только его экран', locked0 && !locked1);

  // --- keyboard behind the curtain does nothing
  const before = await students[0].evaluate(
    () => document.querySelector('.count')?.textContent ?? '',
  );
  await students[0].keyboard.press('ArrowRight');
  await students[0].keyboard.press('ArrowRight');
  await students[0].waitForTimeout(300);
  const after = await students[0].evaluate(
    () => document.querySelector('.count')?.textContent ?? '',
  );
  check('за шторкой стрелки не листают урок', before === after, `${before} → ${after}`);

  // --- unlock from the same tile
  await lockBtn(0).click();
  await teacher.waitForTimeout(500);
  check(
    'снятие с плитки возвращает к уроку',
    !(await students[0]
      .locator('.lock')
      .isVisible()
      .catch(() => false)),
  );

  // --- lock everybody, then the per-tile unlock must be blocked
  await teacher.locator('button:has-text("Внимание всем")').click();
  await teacher.waitForTimeout(500);
  check(
    '«Внимание всем» закрывает оба экрана',
    (await students[0].locator('.lock').isVisible()) &&
      (await students[1].locator('.lock').isVisible()),
  );
  check('снятие у одного заблокировано, пока закрыты все', await lockBtn(0).isDisabled());
  await teacher.locator('button:has-text("Снять у всех")').click();
  await teacher.waitForTimeout(400);

  // --- measure: select both, "Внимание выбранным", time until the curtain shows up
  const times = [];
  for (let i = 0; i < 10; i++) {
    await teacher.locator('.tile .pick >> nth=0').click();
    const t0 = Date.now();
    await teacher.locator('button:has-text("Внимание выбранным")').click();
    await students[0].waitForSelector('.lock', { timeout: 3000 });
    times.push(Date.now() - t0);
    await teacher.locator('button:has-text("Снять у выбранных")').click();
    await students[0].waitForSelector('.lock', { state: 'hidden', timeout: 3000 });
    await teacher.locator('.tile .pick >> nth=0').click();
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const max = Math.max(...times);
  check(
    '«Внимание» доходит меньше чем за секунду',
    max < 1000,
    `среднее ${avg} мс, максимум ${max} мс`,
  );

  // --- hand: student raises, teacher puts down
  await students[1].locator('button.hand').click();
  await teacher.waitForTimeout(500);
  const handTile = teacher.locator('.tile', { has: teacher.locator('.flag.hand') }).first();
  check('поднятая рука видна учителю', (await handTile.count()) > 0);
  await handTile.locator('.act.hand').click();
  await teacher.waitForTimeout(500);
  check('учитель опускает руку', (await teacher.locator('.flag.hand').count()) === 0);

  // --- escapes counter
  await students[1].evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await teacher.waitForTimeout(600);
  await students[1].evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await teacher.waitForTimeout(600);
  const escText = await teacher.locator('.flag.away').allInnerTexts();
  check(
    'счётчик «выходил N раз» появился на плитке',
    escText.some((x) => /выходил/.test(x)),
    escText.join(' | '),
  );

  await teacher.screenshot({ path: `${S}/s110-teacher.png` });
  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + [...ok, ...bad].join('\n'));
  console.log(`\nзамер «Внимание»: ${times.join(', ')} мс`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
