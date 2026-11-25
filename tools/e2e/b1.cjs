// B1 (STAGE6.md): reports — the school's by class and parallel, a class's by child, both to Excel.
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
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/teacher`);

  // A column of grades today, one child absent.
  await page.evaluate(async () => {
    const send = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      }).then((r) => r.json());
    const today = new Date().toISOString().slice(0, 10);
    const j = await send('POST', '/api/journal/class-1a/columns', { date: today, title: 'Устно' });
    const column = { kind: 'manual', columnId: j.lessons.at(-1).columnId };
    await send('PUT', '/api/journal/class-1a/cell', { column, studentId: 'student-01', value: 5 });
    await send('PUT', '/api/journal/class-1a/cell', { column, studentId: 'student-02', value: 4 });
    await send('PUT', '/api/journal/class-1a/cell', { column, studentId: 'student-03', value: 4 });
  });

  await page.goto(`${BASE}/school/school-demo#reports`);
  await page.waitForSelector('[data-report-row="1А"]');
  const row = await page.locator('[data-report-row="1А"]').innerText();
  check(
    'отчёт школы: строка класса 1А',
    /20/.test(row) && /4\.33/.test(row) && /1 \/ 2 \/ 0 \/ 0/.test(row),
    row.replace(/\s+/g, ' '),
  );
  check('и параллель', (await page.locator('[data-report-row="1"]').count()) === 1);
  check(
    'период — учебный год',
    /01\.09\.\d{4}/.test(await page.locator('[data-period]').innerText()),
  );
  const xlsx = await page.evaluate(
    async () => (await fetch('/api/schools/school-demo/reports.xlsx')).status,
  );
  check('выгрузка отчёта школы в Excel', xlsx === 200);
  await page.screenshot({ path: `${S}/b1-school.png`, fullPage: true });

  // A period with nothing in it.
  await page.fill('input[data-field=report-from]', '2000-01-01');
  await page.fill('input[data-field=report-to]', '2000-12-31');
  await page.locator('button:has-text("Показать")').click();
  await page.waitForFunction(() =>
    /2000/.test(document.querySelector('[data-period]')?.textContent ?? ''),
  );
  check(
    'другой период — другие цифры',
    /— \/ — |—/.test(await page.locator('[data-report-row="1А"]').innerText()),
  );

  await page.goto(`${BASE}/teacher/class/class-1a`);
  await page.locator('a:has-text("Отчёт")').click();
  await page.waitForURL('**/teacher/class/class-1a/report');
  await page.waitForSelector('[data-student="Алиев Тимур"]');
  check(
    'отчёт класса: по каждому ребёнку',
    (await page.locator('[data-student="Алиев Тимур"]').innerText()).includes('5'),
  );
  await page.screenshot({ path: `${S}/b1-class.png`, fullPage: true });

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
