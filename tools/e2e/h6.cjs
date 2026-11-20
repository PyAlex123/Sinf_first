// H6 (STAGE3.md): Paint on the practice. A fake WebView2 channel plays the classroom app: it answers
// "launch" with "Paint is open" and can press "Помогите" on the strip over Paint.
// The server must run with CLASSROOM_MODE=1.
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
  const code = details.students.find((s) => s.lastName === 'Алиев').code;

  const pc = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  pc.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await pc.addInitScript(() => {
    window.sinfHost = { isDesktop: true, role: 'student', version: '0.1.0.0', pcName: 'ПК-05' };
    const listeners = [];
    window.__toHost = [];
    window.__emit = (data) => listeners.forEach((l) => l({ data }));
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (m) => {
        window.__toHost.push(m);
        if (m.type === 'launch')
          setTimeout(() => window.__emit({ type: 'app', running: true }), 50);
        if (m.type === 'closeApps')
          setTimeout(() => window.__emit({ type: 'app', running: false }), 50);
      },
      addEventListener: (_t, l) => listeners.push(l),
      removeEventListener: (_t, l) => listeners.splice(listeners.indexOf(l), 1),
    };
  });
  await pc.goto(`${BASE}/join`);
  await pc.waitForSelector('.waiting');

  await teacher
    .locator('.lcard', { hasText: 'Радуга' })
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
  check('до практики кнопки Paint нет', (await pc.locator('button.paint').count()) === 0);

  for (let i = 0; i < 3; i++) {
    await teacher.locator('button:has-text("Пропустить")').click();
    await wait(250);
  }
  await pc.waitForSelector('button.paint', { timeout: 4000 });
  check(
    'на практике есть «Открыть Paint»',
    (await pc.locator('button.paint').innerText()).includes('Открыть Paint'),
  );
  await pc.locator('button.paint').click();
  await wait(300);
  const launched = await pc.evaluate(() =>
    window.__toHost.filter((m) => m.type === 'launch').map((m) => m.app),
  );
  check('приложение просят открыть Paint', launched.at(-1) === 'paint', JSON.stringify(launched));
  check(
    'кнопка стала «Вернуться в Paint»',
    (await pc.locator('button.paint').innerText()).includes('Вернуться в Paint'),
  );
  await pc.screenshot({ path: `${S}/65-h6-paint-button.png` });

  // "Помогите" pressed on the strip over Paint raises the hand on the teacher's tile.
  await pc.evaluate(() => window.__emit({ type: 'hand' }));
  await teacher.waitForSelector('.tile .flag.hand', { timeout: 3000 });
  check('«Помогите» с панели над Paint поднимает руку у учителя', true);

  await teacher.locator('button:has-text("Пропустить")').click();
  await wait(600);
  const closed = await pc.evaluate(
    () => window.__toHost.filter((m) => m.type === 'closeApps').length,
  );
  check('конец практики — приложение просят закрыть Paint', closed === 1, String(closed));
  check('после практики кнопки Paint нет', (await pc.locator('button.paint').count()) === 0);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
