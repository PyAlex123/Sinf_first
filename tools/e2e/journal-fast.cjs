// Review 2026-11-25: the journal keeps every grade typed fast, takes a grade from the mouse, keeps
// the table on an error; the lesson's arrows do not turn slides from the message field.
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const cellText = (page, cell) =>
  page
    .locator(`[data-cell="${cell}"]`)
    .innerText()
    .then((s) => s.trim());

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Мои уроки');

  await page.goto(`${BASE}/teacher/journal/class-1a`);
  await page.locator('button:has-text("Столбец без урока")').click();
  await page.fill('input[data-field=column-date]', '2026-11-21');
  await page.fill('input[data-field=column-title]', 'Быстрый ввод');
  await page.locator('button:has-text("Добавить столбец")').click();
  await page.waitForSelector('th.day.manual');

  // Four grades as fast as the keyboard goes, nothing awaited in between.
  await page.locator('[data-cell="0:0"]').focus();
  for (const d of ['5', '4', '3', '2']) await page.keyboard.press(`Digit${d}`);
  const typed = [];
  for (let r = 0; r < 4; r++) typed.push(await cellText(page, `${r}:0`));
  check('быстрый ввод виден сразу', typed.join(' ') === '5 4 3 2', typed.join(' '));
  await page.waitForFunction(() => !document.querySelector('td.cell.saving'), null, {
    timeout: 10000,
  });
  await page.reload();
  await page.waitForSelector('[data-cell="3:0"]');
  const kept = [];
  for (let r = 0; r < 4; r++) kept.push(await cellText(page, `${r}:0`));
  check(
    'после перезагрузки все четыре оценки на месте',
    kept.join(' ') === '5 4 3 2',
    kept.join(' '),
  );

  // The mouse: a click opens the menu, a grade sets the cell.
  await page.locator('[data-cell="4:0"]').click();
  await page.waitForSelector('[data-journal-menu]');
  await page.locator('[data-journal-menu]').getByRole('button', { name: '3', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-cell="4:0"]')?.textContent?.trim() === '3',
  );
  check('оценка мышью через меню клетки', true);
  await page.locator('[data-cell="5:0"]').click();
  await page.locator('[data-journal-menu]').getByRole('button', { name: 'н', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-cell="5:0"]')?.textContent?.trim() === 'н',
  );
  check('«н» мышью', true);
  await page.locator('[data-cell="5:0"]').click();
  await page.keyboard.press('Escape');
  check('Esc закрывает меню', (await page.locator('[data-journal-menu]').count()) === 0);

  // A save the server refuses (the network fails once): the table stays, the cell says so,
  // "Retry" saves it.
  let refused = false;
  await page.route('**/api/journal/class-1a/cell', async (route) => {
    if (refused) return route.continue();
    refused = true;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal', message: 'test' }),
    });
  });
  await page.locator('[data-cell="6:0"]').focus();
  await page.keyboard.press('Digit4');
  await page.waitForSelector('[data-journal-error]', { timeout: 5000 });
  check('ошибка не прячет таблицу', (await page.locator('table').count()) === 1);
  check(
    'клетка с ошибкой помечена',
    (await page.locator('td.failed [data-cell="6:0"]').count()) === 1,
  );
  await page.locator('[data-journal-error] button:has-text("Повторить")').click();
  await page.waitForFunction(() => !document.querySelector('td.failed'), null, { timeout: 5000 });
  await page.unroute('**/api/journal/class-1a/cell');
  await page.reload();
  await page.waitForSelector('[data-cell="6:0"]');
  check('«Повторить» сохранила оценку', (await cellText(page, '6:0')) === '4');

  await page.goto(`${BASE}/teacher`);
  await page.click('text=Начать урок >> nth=0');
  await page.waitForURL('**/teacher/session/**');
  const sessionUrl = page.url();

  // The message field: the arrows move the caret, not the class's slide.
  await page.goto(sessionUrl);
  const field = page.locator('textarea[data-field=message]');
  await field.waitFor();
  const before = await page.locator('text=/Экран \\d+ из \\d+/').first().innerText();
  await field.fill('Смотрите на доску');
  await field.press('ArrowLeft');
  await field.press('ArrowRight');
  await page.waitForTimeout(400);
  const after = await page.locator('text=/Экран \\d+ из \\d+/').first().innerText();
  check(
    'стрелки в поле «Сообщение классу» не листают слайды',
    before === after,
    `${before} → ${after}`,
  );
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowRight');
  await page
    .waitForFunction((was) => !document.body.innerText.includes(was), before, { timeout: 5000 })
    .catch(() => {});
  const turned = await page.locator('text=/Экран \\d+ из \\d+/').first().innerText();
  check('стрелка вне поля листает', turned !== before, `${before} → ${turned}`);

  // The main page: a lesson that does not start says so on top, and the page stays.
  await page.goto(`${BASE}/teacher`);
  await page.waitForSelector('text=Начать урок');
  await page.route('**/api/sessions', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'internal', message: 'Не удалось начать урок' }),
        })
      : route.continue(),
  );
  await page.click('text=Начать урок >> nth=0');
  await page.waitForSelector('[data-dashboard-error]', { timeout: 5000 });
  check(
    'ошибка «Начать урок» не стирает главную',
    (await page.locator('text=Начать урок').count()) > 0,
  );
  await page.unroute('**/api/sessions');

  // The refused saves and starts above are staged on purpose.
  const real = errors.filter((e) => !e.includes('status of 500'));
  check(
    'ошибок в консоли нет (кроме подстроенной)',
    real.length === 0,
    real.slice(0, 2).join(' | '),
  );
  console.log(out.join('\n'));
  await browser.close();
})();
