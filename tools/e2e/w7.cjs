// W7 (STAGE4.md): a programme by quarters, given to a class; the main page offers the next lesson.
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Программа класса');
  check(
    'на главной блок «Программа класса»',
    (await page.locator('text=Программа не выбрана').count()) === 1,
  );

  // ---------- a programme
  await page.goto(`${BASE}/teacher/programs`);
  await page.fill('input[data-field=program-title]', '1 класс, информатика');
  await page.locator('button:has-text("Создать программу")').click();
  await page.waitForURL(/\/teacher\/programs\/p-[0-9a-f]{32}$/);
  await page.waitForSelector('[data-pick="g10"]');
  await page.selectOption('select[data-field=quarter]', '2');
  await page.locator('[data-pick="g10"]').click();
  await page.locator('[data-pick="g11"]').click();
  await page.fill('input[data-field=search]', 'Радуга');
  await page.locator('[data-pick="k10"]').click();
  check(
    'три урока во второй четверти',
    (await page.locator('[data-quarter="2"] li').count()) === 3 &&
      (await page.locator('[data-quarter="1"] li').count()) === 0,
  );
  await page.locator('button:has-text("Сохранить")').click();
  await page.waitForSelector('.status[data-status=saved]');
  await page.reload();
  await page.waitForSelector('[data-quarter="2"] li');
  check(
    'после перезагрузки программа на месте',
    (await page.locator('[data-quarter="2"] li').count()) === 3,
  );
  await page.screenshot({ path: `${S}/w7-program.png` });

  // ---------- given to the class
  await page.goto(`${BASE}/teacher`);
  await page.waitForSelector('text=Программа класса');
  await page.locator('button:has-text("Выбрать программу")').click();
  await page.waitForSelector('select[data-field=class-program] option:nth-child(2)', {
    state: 'attached',
  });
  const value = await page
    .locator('select[data-field=class-program] option:nth-child(2)')
    .getAttribute('value');
  await page.selectOption('select[data-field=class-program]', value);
  await page.waitForSelector('[data-next="g10"]');
  check('следующий урок — первый урок программы', true);
  await page.screenshot({ path: `${S}/w7-next.png` });

  // ---------- after the lesson, the next one
  await page.locator('[data-next="g10"] button:has-text("Начать")').click();
  await page.waitForURL(/\/teacher\/session\//);
  await page.locator('button:has-text("Завершить урок")').click();
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/teacher`);
  await page.waitForSelector('[data-next="g11"]');
  check('после урока следующий — второй урок программы', true);
  check(
    '«Пройдено уроков: 1 из 3»',
    (await page.locator('text=Пройдено уроков: 1 из 3').count()) === 1,
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
