// H2 (STAGE3.md): seating. Two classroom computers (the Windows app's bridge injected into Chromium)
// wait for the lesson, children log in by name and pictures; the next lesson names them right away.
// The server must run with CLASSROOM_MODE=1, as the teacher's Windows app starts it.
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  teacher.on('dialog', (d) => void d.accept());
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")');
  const details = await teacher.evaluate(async () => (await fetch('/api/classes/class-1a')).json());
  const codeOf = (last) => details.students.find((s) => s.lastName === last).code;

  async function computer(pcName) {
    const page = await (
      await browser.newContext({ viewport: { width: 1366, height: 768 } })
    ).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${pcName}: ${m.text()}`));
    await page.addInitScript((name) => {
      window.sinfHost = { isDesktop: true, role: 'student', version: '0.1.0.0', pcName: name };
    }, pcName);
    await page.goto(`${BASE}/join`);
    return page;
  }

  async function pressCode(page, lastName) {
    const lookup = await page.evaluate(
      async (pc) => (await fetch(`/api/join/room?pc=${encodeURIComponent(pc)}`)).json(),
      'x',
    );
    const pics = lookup.lesson.codePics;
    for (const key of codeOf(lastName)) {
      await page.locator('.choice').nth(pics.indexOf(key)).click();
      await wait(120);
    }
    await page.waitForURL('**/s/**', { timeout: 10000 });
  }

  async function startLesson() {
    await teacher.goto(`${BASE}/teacher`);
    await teacher.waitForSelector('h2:has-text("Уроки")');
    await teacher
      .locator('.lcard', { hasText: 'Предыдущий — последующий' })
      .locator('button:has-text("Начать урок")')
      .click();
    await teacher.waitForURL('**/teacher/session/**');
  }

  // ---------- before any lesson: the computers wait
  const pc5 = await computer('ПК-05');
  const pc6 = await computer('ПК-06');
  await pc5.waitForSelector('.waiting');
  check('ПК без урока ждут учителя', (await pc6.locator('.waiting').count()) === 1);
  await pc5.screenshot({ path: `${S}/61-h2-waiting.png` });

  // ---------- lesson 1: nobody is seated yet
  await startLesson();
  await pc5.waitForSelector('.names button', { timeout: 6000 });
  // Each computer asks every 3 s on its own: wait for the second one too.
  await pc6.waitForSelector('.names button', { timeout: 6000 });
  check(
    'урок начался — ПК сами открыли список класса',
    (await pc6.locator('.names button').count()) === 20,
  );
  await pc5.locator('.names button', { hasText: 'Алиев' }).click();
  await pressCode(pc5, 'Алиев');
  await pc6.locator('.names button', { hasText: 'Каримова' }).click();
  await pressCode(pc6, 'Каримова');
  check('оба ученика вошли без кода урока', true);

  // ---------- the lesson ends: back to waiting
  await teacher.locator('button:has-text("Завершить урок")').click();
  await teacher.waitForURL('**/results');
  await pc5.waitForSelector('.waiting', { timeout: 10000 });
  check(
    'после «Завершить урок» ПК снова ждут',
    (await pc6.waitForSelector('.waiting', { timeout: 10000 })) !== null,
  );

  // ---------- lesson 2: everyone is named straight away
  await startLesson();
  await pc5.waitForSelector('text=Привет, Тимур!', { timeout: 6000 });
  await pc6.waitForSelector('text=Привет, Мадина!', { timeout: 6000 });
  check('второй урок: на ПК-05 сразу «Привет, Тимур!», на ПК-06 «Привет, Мадина!»', true);
  await pc5.screenshot({ path: `${S}/62-h2-seated.png` });

  // ---------- "Это не я"
  await pc6.locator('button:has-text("Это не я")').click();
  check('«Это не я» открывает список класса', (await pc6.locator('.names button').count()) === 20);

  // ---------- a plain browser is untouched
  const plain = await (await browser.newContext()).newPage();
  await plain.goto(`${BASE}/join`);
  await plain.waitForSelector('.codeform');
  check('в обычном браузере по-прежнему код урока', true);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
