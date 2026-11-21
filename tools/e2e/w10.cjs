// W10 (STAGE4.md): the KTP from Word and from Excel — the wizard guesses the columns, shows what is
// skipped, saves, and the plan goes back to Excel.
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
const FIXTURES = join(__dirname, '..', '..', 'apps', 'server', 'test', 'fixtures', 'ktp');
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
  await page.waitForSelector('text=Мои уроки');

  await page.goto(`${BASE}/teacher`);
  await page.locator('a:has-text("КТП")').first().click();
  await page.waitForURL('**/teacher/ktp');
  await page.locator('a:has-text("Загрузить КТП")').first().click();
  await page.waitForURL('**/teacher/ktp/import');

  // Word: a heading, a table, quarter rows across it.
  await page.setInputFiles('input[data-field=ktp-file]', join(FIXTURES, 'ktp.docx'));
  await page.waitForSelector('[data-summary]');
  const guessed = await page.$$eval('select[data-map]', (s) =>
    Object.fromEntries(s.map((e) => [e.dataset.map, e.selectedOptions[0]?.textContent ?? ''])),
  );
  check(
    'Word: колонки угаданы по заголовку',
    /Тема/.test(guessed.topic) && /Часы/.test(guessed.hours) && /Дата/.test(guessed.weekOrDate),
    JSON.stringify(guessed),
  );
  const summary = (await page.locator('[data-summary]').innerText()).replace(/\s+/g, ' ');
  check(
    'Word: строки четвертей пропущены и показаны',
    /пропущено строк: [1-9]/.test(summary),
    summary,
  );
  await page.screenshot({ path: `${S}/w10-wizard.png`, fullPage: true });

  // Excel: a title row over the header, a week and a date column; the date wins.
  await page.setInputFiles('input[data-field=ktp-file]', join(FIXTURES, 'ktp.xlsx'));
  await page.waitForFunction(() =>
    /Колонка 5/.test(
      document.querySelector('select[data-map=weekOrDate]')?.selectedOptions[0]?.textContent ?? '',
    ),
  );
  const header = await page.$eval(
    'select[data-field=ktp-header]',
    (s) => s.selectedOptions[0]?.textContent ?? '',
  );
  check('Excel: заголовок найден под строкой названия', /^2:/.test(header), header);
  const firstDate = await page.locator('tr[data-line="3"] td').nth(4).innerText();
  check('Excel: дата прочитана как дата', /^\d{2}\.\d{2}\.\d{4}$/.test(firstDate), firstDate);

  // The teacher says the plan follows weeks after all.
  const week = await page.$eval(
    'select[data-map=weekOrDate]',
    (s) => [...s.options].find((o) => /Неделя/.test(o.textContent ?? ''))?.value,
  );
  await page.selectOption('select[data-map=weekOrDate]', week);
  check(
    'колонку можно поправить руками',
    /^\d+$/.test(await page.locator('tr[data-line="3"] td').nth(4).innerText()),
  );

  await page.fill('input[data-field=ktp-title]', 'Информатика, I полугодие');
  await page.locator('button:has-text("Сохранить")').click();
  await page.waitForURL(/\/teacher\/ktp\/[0-9a-f-]{36}$/);
  await page.waitForSelector('tr[data-row]');
  const saved = await page.locator('tr[data-row]').count();
  check('КТП сохранён: 8 тем', saved === 8, String(saved));
  await page.screenshot({ path: `${S}/w10-plan.png`, fullPage: true });

  const xlsx = await page.evaluate(async () => {
    const res = await fetch(`/api/ktp/${location.pathname.split('/').pop()}/export.xlsx?lang=ru`);
    return [res.status, res.headers.get('content-type')];
  });
  check('выгрузка КТП в Excel', xlsx[0] === 200 && /spreadsheetml/.test(xlsx[1] ?? ''));

  await page.goto(`${BASE}/teacher/ktp`);
  await page.waitForSelector('[data-ktp]');
  check(
    'КТП в списке с числом тем',
    /8 тем/.test(await page.locator('[data-ktp]').first().innerText()),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
