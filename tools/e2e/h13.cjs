// H13 (STAGE3.md): practice tasks and checkers. The teacher opens the sample task "Оформи документ"
// (5 automatic and 2 manual criteria), checks the reference file in the browser — and the server
// checks it once more and agrees; a wrong file fails; an Excel task is assembled from scratch.
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
const FIX = join(__dirname, '../../packages/checkers/fixtures');
mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const fixture = (path, name, mimeType) => ({
  name,
  mimeType,
  buffer: readFileSync(join(FIX, path)),
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('h2:has-text("Уроки")');
  await page.locator('a:has-text("Задания практики")').click();
  await page.waitForSelector('.crit');
  check(
    'образец «Оформи документ»: 5 проверок и 2 ручных критерия',
    (await page.locator('.crit').count()) === 7 &&
      (await page.locator('.crit:has-text("Учитель отмечает сам")').count()) === 2,
  );

  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await page
    .locator('input[type=file]')
    .setInputFiles(fixture('docx/russian-word.docx', 'Эталон.docx', docx));
  const started = Date.now();
  await page.locator('button:has-text("Проверить")').last().click();
  await page.waitForSelector('text=Эталон проходит все автоматические критерии.');
  check(
    'эталон проходит все автоматические критерии (проверка в браузере)',
    true,
    `${Date.now() - started} мс вместе с сервером`,
  );
  await page.waitForSelector('text=сервер согласен');
  check('сервер проверил ещё раз и согласен', true);
  check('у каждого критерия видно «Да»', (await page.locator('.crit.pass').count()) === 5);
  await page.screenshot({ path: `${S}/131-h13-reference.png`, fullPage: true });

  await page
    .locator('input[type=file]')
    .setInputFiles(fixture('docx/bad.docx', 'Неверный.docx', docx));
  await page.locator('button:has-text("Проверить")').last().click();
  await page.waitForSelector('text=/Эталон набрал 0 из 5/');
  check(
    'неверный файл: 0 из 5, и видно, что найдено',
    (await page.locator('.crit.fail').first().innerText()).includes('Нет'),
  );

  await page
    .locator('input[type=file]')
    .setInputFiles(fixture('docx/protected.docx', 'Старый.docx', docx));
  await page.locator('button:has-text("Проверить")').last().click();
  await page.waitForSelector('text=/старого формата/');
  check('файл старого формата или с паролем — понятное сообщение, а не «всё неверно»', true);

  // An Excel task from scratch: one check of a cell's formula.
  await page.locator('label:has-text("Программа") select').selectOption('excel');
  check(
    'при смене программы автоматические критерии Word убраны',
    (await page.locator('.crit select').count()) === 0,
  );
  await page.locator('button:has-text("Добавить проверку")').click();
  const row = page.locator('.crit').last();
  await row.locator('select').first().selectOption('xlsx.formula');
  await row.locator('label:has-text("ячейка") input').fill('B5');
  await row.locator('label:has-text("функция") input').fill('SUM');
  await page
    .locator('input[type=file]')
    .setInputFiles(
      fixture(
        'xlsx/good.xlsx',
        'Расходы.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    );
  await page.locator('button:has-text("Проверить")').last().click();
  await page.waitForSelector('text=Эталон проходит все автоматические критерии.');
  check(
    'задание Excel собрано с нуля, эталон проходит, видна формула',
    (await row.innerText()).includes('=SUM(B2:B4)'),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
