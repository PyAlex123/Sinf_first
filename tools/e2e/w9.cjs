// W9 (STAGE4.md): the journal by hand — a column without a lesson, the whole class graded from the
// keyboard, "н", a note, and it all stays after a reload.
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
  page.on(
    'dialog',
    (d) => void (d.type() === 'prompt' ? d.accept('Устно, без ошибок') : d.accept()),
  );
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Мои уроки');

  await page.goto(`${BASE}/teacher/journal/class-1a`);
  await page.locator('button:has-text("Столбец без урока")').click();
  await page.fill('input[data-field=column-date]', '2026-11-20');
  await page.fill('input[data-field=column-title]', 'Устный опрос');
  await page.locator('button:has-text("Добавить столбец")').click();
  await page.waitForSelector('th.day.manual');
  check(
    'столбец без урока добавлен',
    (await page.locator('th.day.manual .topic').innerText()) === 'Устный опрос',
  );

  // The whole class from the keyboard: a digit per child, the cursor goes down by itself.
  const rows = await page.locator('tbody tr').count();
  await page.locator('[data-cell="0:0"]').click();
  const started = Date.now();
  const marks = [];
  for (let i = 0; i < rows; i += 1) {
    const mark = i === 1 ? 'н' : String(5 - (i % 4));
    marks.push(mark);
    await page.keyboard.press(mark === 'н' ? 'KeyY' : `Digit${mark}`);
    await page.waitForFunction(
      ([row, want]) =>
        document.querySelector(`[data-cell="${row}:0"]`)?.textContent?.trim() === want,
      [i, mark === 'н' ? 'н' : mark],
      { timeout: 5000 },
    );
  }
  const seconds = (Date.now() - started) / 1000;
  check(
    `весь класс (${rows}) с клавиатуры меньше чем за минуту`,
    seconds < 60,
    `${seconds.toFixed(1)} с`,
  );

  await page.locator('[data-cell="0:0"]').focus();
  await page.keyboard.press('KeyC');
  await page.waitForSelector('td.noted');
  check(
    'комментарий к оценке',
    (await page.locator('td.noted').getAttribute('title')) === 'Устно, без ошибок',
  );

  await page.locator('[data-cell="2:0"]').focus();
  await page.keyboard.press('Backspace');
  await page.waitForFunction(
    () => document.querySelector('[data-cell="2:0"]')?.textContent?.trim() === '·',
  );
  check('Backspace стирает оценку', true);
  await page.screenshot({ path: `${S}/w9-journal.png` });

  await page.reload();
  await page.waitForSelector('[data-cell="0:0"]');
  const after = [0, 1, 2, 3].map(async (i) =>
    (await page.locator(`[data-cell="${i}:0"]`).innerText()).trim(),
  );
  const got = await Promise.all(after);
  check(
    'после перезагрузки оценки на месте',
    got[0] === marks[0] && got[1] === 'н' && got[2] === '·' && got[3] === marks[3],
    got.join(' '),
  );

  const xlsx = await page.evaluate(
    async () => (await fetch('/api/journal/class-1a/export.xlsx')).status,
  );
  check('выгрузка в Excel работает со столбцом без урока', xlsx === 200);

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
