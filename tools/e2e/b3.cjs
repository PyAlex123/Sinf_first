// B3 (STAGE6.md): the English interface — chosen on the start page, kept on reload, used by the
// teacher's pages and by the Excel exports; lesson content stays in Russian and Uzbek.
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
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // The first visit: the start page in Russian, three buttons for the language.
  const loaded = [];
  page.on('request', (r) => /\/assets\/en-.*\.js$/.test(r.url()) && loaded.push(r.url()));
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.lang button');
  check('три языка в переключателе', (await page.locator('.lang button').count()) === 3);
  check('словарь английского не грузится, пока он не выбран', loaded.length === 0);

  await page.click('.lang button:has-text("English")');
  await page.waitForSelector('text=I’m a student');
  check('английский выбран', (await page.locator('html').getAttribute('lang')) === 'en');
  check('словарь подгрузился отдельным файлом', loaded.length === 1, loaded[0] ?? '');

  await page.reload();
  await page.waitForSelector('text=I’m a teacher');
  check(
    'после перезагрузки язык остался',
    (await page.locator('html').getAttribute('lang')) === 'en',
  );

  await page.goto(`${BASE}/teacher/login`);
  await page.waitForSelector('h1:has-text("Teacher sign-in")');
  check('вход учителя по-английски', true);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/teacher`);
  await page.waitForSelector('text=Sign out');
  check('кабинет учителя по-английски', true);
  await page.screenshot({ path: `${S}/b3-dashboard.png` });

  await page.goto(`${BASE}/teacher/journal/class-1a`);
  await page.waitForSelector('h1:has-text("Gradebook")');
  check('журнал по-английски', true);
  const exportName = await page.evaluate(async () => {
    // The button is off while the journal is empty; the address is the one it would use.
    const href = '/api/journal/class-1a/export.xlsx?lang=' + document.documentElement.lang;
    const res = await fetch(href);
    return `${res.status} ${href} ${res.headers.get('content-disposition') ?? ''}`;
  });
  check('выгрузка журнала по-английски', /^200 .*lang=en .*gradebook/.test(exportName), exportName);

  // Back to Russian with one click; the dictionary is already there.
  await page.goto(`${BASE}/`);
  await page.click('.lang button:has-text("Русский")');
  await page.waitForSelector('text=Я ученик');
  check('обратно на русский', (await page.locator('html').getAttribute('lang')) === 'ru');

  check('без ошибок в консоли', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})();
