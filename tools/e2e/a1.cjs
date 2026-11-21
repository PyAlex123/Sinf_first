// A1 (STAGE5.md): the rules of a school — the administrator sets the folder, the keeping day and
// the programs; they stay after a reload; another teacher of the school does not see them.
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

async function login(page, email, password) {
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/teacher`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await login(page, 'demo@sinf.local', 'demo1234');

  await page.goto(`${BASE}/school/school-demo`);
  await page.waitForSelector('input[data-field=quota]');
  check(
    'по умолчанию: 200 МБ, файл 50 МБ, все пять программ',
    (await page.inputValue('input[data-field=quota]')) === '200' &&
      (await page.inputValue('input[data-field=max-file]')) === '50' &&
      (await page.locator('input[data-app]:checked').count()) === 5,
  );

  await page.fill('input[data-field=quota]', '100');
  await page.fill('input[data-field=max-file]', '20');
  await page.selectOption('select[data-field=keep-month]', '6');
  await page.selectOption('select[data-field=keep-day]', '30');
  await page.locator('input[data-app=powerpoint]').uncheck();
  await page.locator('input[data-app=excel]').uncheck();
  await page
    .locator('input[data-field=quota]')
    .locator('xpath=ancestor::form')
    .locator('button[type=submit]')
    .click();
  await page.waitForSelector('[data-saved]');
  await page.screenshot({ path: `${S}/a1-settings.png`, fullPage: true });

  await page.reload();
  await page.waitForSelector('input[data-field=quota]');
  const apps = await page.$$eval('input[data-app]:checked', (els) => els.map((e) => e.dataset.app));
  check(
    'после перезагрузки всё на месте',
    (await page.inputValue('input[data-field=quota]')) === '100' &&
      (await page.inputValue('input[data-field=max-file]')) === '20' &&
      (await page.inputValue('select[data-field=keep-day]')) === '30' &&
      (await page.inputValue('select[data-field=keep-month]')) === '6' &&
      apps.join(',') === 'paint,notepad,word',
    apps.join(','),
  );

  // A teacher of the school, not its administrator, sees no rules.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${BASE}/teacher/register`);
  await other.fill('input[autocomplete=name]', 'Учитель Школы');
  await other.fill('input[type=email]', 'member@example.com');
  await other.fill('input[type=password]', 'member-pass-1');
  await other.click('button[type=submit]');
  await other.waitForURL(`${BASE}/teacher`);
  const asked = await other.evaluate(async () => {
    await fetch('/api/schools/school-demo/requests', { method: 'POST' });
    return (await fetch('/api/schools/school-demo/settings')).status;
  });
  await page.evaluate(async () => {
    const d = await (await fetch('/api/schools/school-demo')).json();
    const r = d.requests.find((x) => x.email === 'member@example.com');
    await fetch(`/api/schools/school-demo/requests/${r.userId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
  });
  await other.goto(`${BASE}/school/school-demo`);
  await other.waitForSelector('h2');
  check(
    'учителю школы правила не видны',
    asked === 404 && (await other.locator('input[data-field=quota]').count()) === 0,
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
