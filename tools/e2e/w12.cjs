// W12 (STAGE4.md): towards eMaktab — a reminder on the home page and in the journal while the 72
// hours run, the "as in eMaktab" view, a column marked as moved and unmarked.
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
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Мои уроки');

  // A lesson held and graded (one child, five stars — a suggestion), and an oral check today.
  await page.evaluate(async () => {
    const post = (url, body, method = 'POST') =>
      fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const today = new Date().toISOString().slice(0, 10);
    const j = await post('/api/journal/class-1a/columns', { date: today, title: 'Устно' });
    const column = { kind: 'manual', columnId: j.lessons.at(-1).columnId };
    await post('/api/journal/class-1a/cell', { column, studentId: 'student-01', value: 5 }, 'PUT');
    await post('/api/journal/class-1a/cell', { column, studentId: 'student-02', value: 4 }, 'PUT');
    await post(
      '/api/journal/class-1a/cell',
      { column, studentId: 'student-03', absent: true },
      'PUT',
    );
  });

  await page.goto(`${BASE}/teacher`);
  await page.waitForSelector('[data-emaktab-reminders]');
  const home = await page.locator('[data-emaktab-reminders]').innerText();
  check(
    'на главной — напоминание про eMaktab',
    /1А/.test(home) && /Устно/.test(home) && /ч/.test(home),
    home.trim(),
  );

  await page.locator('[data-emaktab-reminders] a').first().click();
  await page.waitForURL('**/teacher/journal/class-1a');
  await page.waitForSelector('[data-emaktab-due]');
  const banner = await page.locator('[data-emaktab-due]').innerText();
  check(
    'в журнале — что не перенесено и сколько часов осталось',
    /Устно — остал\S* \d+ ч/.test(banner),
    banner,
  );

  const button = page.locator('button[data-emaktab]');
  check('над столбцом — «→ eMaktab · N ч»', /→ eMaktab · \d+ ч/.test(await button.innerText()));

  await page.locator('[data-view=emaktab]').click();
  const cells = await page.locator('td.cell').allInnerTexts();
  check(
    'вид «как в eMaktab»: только оценки и «н»',
    cells.every((c) => /^(|[2-5]|н|·)$/.test(c.trim())) && cells.some((c) => c.trim() === 'н'),
    [...new Set(cells.map((c) => c.trim()))].join(' '),
  );
  await page.screenshot({ path: `${S}/w12-emaktab.png` });

  await button.click();
  await page.waitForSelector('button[data-emaktab].moved');
  check('столбец отмечен «перенесено»', (await button.innerText()).includes('✓ eMaktab'));
  check('напоминание в журнале ушло', (await page.locator('[data-emaktab-due]').count()) === 0);

  await page.goto(`${BASE}/teacher`);
  await page.waitForSelector('text=Мои уроки');
  await page.waitForTimeout(500);
  check('и на главной тоже', (await page.locator('[data-emaktab-reminders]').count()) === 0);

  await page.goto(`${BASE}/teacher/journal/class-1a`);
  await page.locator('button[data-emaktab].moved').click();
  await page.waitForSelector('[data-emaktab-due]');
  check('отметку можно снять', true);

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
