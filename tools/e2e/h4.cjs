// H4 (STAGE3.md): "Attention!" on a classroom computer. The Windows app's bridge and its WebView2
// message channel are imitated in Chromium: the test reads what the lesson page asks the app to do.
// The server must run with CLASSROOM_MODE=1.
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
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
  const code = details.students.find((s) => s.lastName === 'Алиев').code;

  const pc = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  pc.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await pc.addInitScript(() => {
    window.sinfHost = { isDesktop: true, role: 'student', version: '0.1.0.0', pcName: 'ПК-05' };
    window.__toHost = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (m) => window.__toHost.push(m),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
  await pc.goto(`${BASE}/join`);
  await pc.waitForSelector('.waiting');

  await teacher
    .locator('.lcard', { hasText: 'Предыдущий — последующий' })
    .locator('button:has-text("Начать урок")')
    .click();
  await teacher.waitForURL('**/teacher/session/**');
  await pc.waitForSelector('.names button', { timeout: 6000 });
  await pc.locator('.names button', { hasText: 'Алиев' }).click();
  const room = await pc.evaluate(async () => (await fetch('/api/join/room?pc=x')).json());
  for (const key of code) {
    await pc.locator('.choice').nth(room.lesson.codePics.indexOf(key)).click();
    await wait(120);
  }
  await pc.waitForURL('**/s/**');
  await wait(800);

  const tile = (await teacher.locator('.tile').first().innerText()).replace(/\s+/g, ' ');
  check('на плитке учителя видно «ПК-05»', /ПК-05/.test(tile), tile.slice(0, 60));
  const note = (await teacher.locator('.soft').allInnerTexts()).join(' | ');
  check('учителю сказано, что на ПК класса блокировка настоящая', /настоящее/.test(note), note);
  check('пометки «мягкая» нет, когда все в приложении', !/мягкая/.test(note));

  const sent = async () =>
    pc.evaluate(() => window.__toHost.filter((m) => m.type === 'lock').map((m) => m.on));
  await teacher.locator('button:has-text("Внимание всем")').click();
  await pc.waitForSelector('text=Смотрите на учителя', { timeout: 3000 });
  await wait(300);
  check(
    '«Внимание!» просит приложение заблокировать ввод',
    (await sent()).at(-1) === true,
    JSON.stringify(await sent()),
  );
  await teacher.locator('button:has-text("Снять у всех")').click();
  await pc.waitForSelector('text=Смотрите на учителя', { state: 'detached', timeout: 3000 });
  await wait(300);
  check(
    'снятие просит разблокировать',
    (await sent()).at(-1) === false,
    JSON.stringify(await sent()),
  );

  await teacher.locator('button:has-text("Завершить урок")').click();
  await wait(600);
  check('после конца урока ввод разблокирован', (await sent()).at(-1) === false);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
