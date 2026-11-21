// A4 (STAGE5.md): keeping works — the administrator sees when the next cleaning is and what it would
// take; a child's new file is counted; another day moves the cleaning. (The deleting itself is
// checked by the server tests with a fixed date: a browser cannot wait for 1 August.)
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

/** The next time this day comes, in Tashkent, as `дд.мм.гггг` — the day after it is the cleaning. */
function nextCleaning(month, day) {
  const now = new Date(Date.now() + 5 * 3600_000);
  let year = now.getUTCFullYear();
  const end = (y) => Date.UTC(y, month - 1, day + 1);
  if (end(year) <= now.getTime()) year += 1;
  const d = new Date(end(year));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

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

  // A child keeps a file in "Мои работы".
  await page.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const details = await json('GET', '/api/classes/class-1a');
    const s = details.students.find((x) => x.lastName === 'Алиев');
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'k10',
    });
    const { token } = await json('POST', '/api/join', {
      sessionId: session.id,
      studentId: s.id,
      code: s.code,
    });
    await fetch('/api/my/files?name=work.txt', {
      method: 'PUT',
      headers: {
        'x-session-id': session.id,
        'x-participant-token': token,
        'content-type': 'application/octet-stream',
      },
      body: 'моя работа',
    });
  });

  await page.goto(`${BASE}/school/school-demo`);
  await page.waitForSelector('[data-retention]');
  const before = await page.locator('[data-retention]').innerText();
  check(
    'по умолчанию очистка — 1 августа',
    before.includes(`Следующая очистка — ${nextCleaning(7, 31)}`),
    before,
  );
  check('файл ребёнка посчитан', /файлов в папках учеников — 1/.test(before));

  await page.selectOption('select[data-field=keep-month]', '12');
  await page.selectOption('select[data-field=keep-day]', '31');
  await page
    .locator('input[data-field=quota]')
    .locator('xpath=ancestor::form')
    .locator('button[type=submit]')
    .click();
  await page.waitForSelector('[data-saved]');
  const after = await page.locator('[data-retention]').innerText();
  check(
    'другой день — другая дата очистки',
    after.includes(`Следующая очистка — ${nextCleaning(12, 31)}`),
    after,
  );
  await page.screenshot({ path: `${S}/a4-retention.png`, fullPage: true });

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
