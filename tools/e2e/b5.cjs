// B5 (STAGE6.md): practice in Scratch, Arduino and Python. The teacher assembles a task for each
// from the new checks; the reference files of packages/checkers pass in the browser and on the
// server, the wrong ones fail with a reason; the school's rules list the three programs.
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
const fixture = (path, name) => ({
  name,
  mimeType: 'application/octet-stream',
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

  /** Switches the program, removes the sample's manual criteria and adds these checks. */
  async function assemble(app, checks) {
    await page.locator('label:has-text("Программа") select').selectOption(app);
    while ((await page.locator('.crit').count()) > 0) {
      await page.locator('.crit button.x').first().click();
    }
    for (const [type, params] of checks) {
      await page.locator('button:has-text("Добавить проверку")').click();
      const row = page.locator('.crit').last();
      await row.locator('select').first().selectOption(type);
      for (const [label, value] of Object.entries(params)) {
        const field = row.locator(`.params label:has-text("${label}")`);
        if ((await field.locator('select').count()) > 0)
          await field.locator('select').selectOption(value);
        else await field.locator('input').fill(value);
      }
    }
  }

  async function tryFile(path, name) {
    await page.locator('input[type=file]').setInputFiles(fixture(path, name));
    await page.locator('button:has-text("Проверить")').last().click();
  }

  // Python: a loop, the function, what it prints, and whether Python would accept it.
  const options = await page.locator('label:has-text("Программа") select option').allInnerTexts();
  check(
    'в списке программ — Scratch, Arduino, Python',
    ['Scratch', 'Arduino', 'Python'].every((a) => options.includes(a)),
    options.join(', '),
  );
  await assemble('python', [
    ['py.uses', { что: 'for' }],
    ['py.function', { имя: 'total' }],
    ['py.prints', { текст: 'Сумма' }],
    ['py.syntax', {}],
  ]);
  check('задание Python: 4 проверки', (await page.locator('.crit').count()) === 4);
  await tryFile('py/good.py', 'sum.py');
  await page.waitForSelector('text=Эталон проходит все автоматические критерии.');
  await page.waitForSelector('text=сервер согласен');
  check('эталон .py проходит, сервер согласен', true);
  await page.screenshot({ path: `${S}/b5-python.png`, fullPage: true });
  await tryFile('py/bad.py', 'sum.py');
  await page.waitForSelector('text=/Эталон набрал 0 из 4/');
  const syntax = await page.locator('.crit').last().innerText();
  check(
    'неверный .py: 0 из 4, видно «строка 2: нет двоеточия»',
    syntax.includes('строка 2: нет двоеточия'),
    syntax.replace(/\s+/g, ' '),
  );

  // Scratch.
  await assemble('scratch', [
    ['sb3.flag', {}],
    ['sb3.loop', {}],
    ['sb3.sprites', { 'не меньше': '2' }],
  ]);
  await tryFile('sb3/good.sb3', 'Игра.sb3');
  await page.waitForSelector('text=Эталон проходит все автоматические критерии.');
  await page.waitForSelector('text=сервер согласен');
  check('эталон .sb3 проходит, сервер согласен', true);
  await tryFile('sb3/bad.sb3', 'Игра.sb3');
  await page.waitForSelector('text=/Эталон набрал 0 из 3/');
  check(
    'неверный .sb3: 0 из 3, видно «спрайтов: 1»',
    (await page.locator('.crit').last().innerText()).includes('спрайтов: 1'),
  );

  // Arduino.
  await assemble('arduino', [
    ['ino.structure', {}],
    ['ino.pin', { пин: '13' }],
    ['ino.call', { имя: 'delay', 'не меньше': '2' }],
  ]);
  await tryFile('ino/good.ino', 'blink.ino');
  await page.waitForSelector('text=Эталон проходит все автоматические критерии.');
  await page.waitForSelector('text=сервер согласен');
  check('эталон .ino проходит, сервер согласен', true);
  await tryFile('ino/bad.ino', 'blink.ino');
  await page.waitForSelector('text=/Эталон набрал 0 из 3/');
  check(
    'неверный .ino: 0 из 3, видно «нет: loop»',
    (await page.locator('.crit').first().innerText()).includes('нет: loop'),
  );

  // The school allows the three programs by default; the administrator can turn them off.
  await page.goto(`${BASE}/school/school-demo#rules`);
  await page.waitForSelector('input[data-app=python]');
  check(
    'правила школы: Scratch, Arduino, Python разрешены',
    (await page.locator('input[data-app=scratch]').isChecked()) &&
      (await page.locator('input[data-app=arduino]').isChecked()) &&
      (await page.locator('input[data-app=python]').isChecked()),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
