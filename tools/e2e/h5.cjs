// H5 (STAGE3.md): screens of classroom computers. The Windows app is imitated in Chromium: a fake
// WebView2 channel answers the page like the app would — thumbnails while asked, a screenshot on
// request — drawn on a canvas. The server must run with CLASSROOM_MODE=1.
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
    const picture = (w, h, colour) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = colour;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e33';
      g.beginPath();
      g.arc(w / 2, h / 2, h / 3, 0, Math.PI * 2);
      g.fill();
      return c.toDataURL('image/jpeg', 0.7).split(',')[1];
    };
    const emit = (data) => listeners.forEach((l) => l({ data }));
    let timer = null;
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (m) => {
        window.__toHost.push(m);
        if (m.type === 'thumbs') {
          clearInterval(timer);
          if (m.on) {
            emit({ type: 'thumb', jpeg: picture(320, 180, '#9cf') });
            timer = setInterval(
              () => emit({ type: 'thumb', jpeg: picture(320, 180, '#9cf') }),
              3000,
            );
          }
        }
        if (m.type === 'screenshot') {
          emit({
            type: 'screenshot',
            jpeg: picture(1366, 768, '#fc9'),
            width: 1366,
            height: 768,
            reason: m.reason,
          });
        }
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
  await wait(1000);

  const asked = await pc.evaluate(() =>
    window.__toHost.filter((m) => m.type === 'thumbs').map((m) => m.on),
  );
  check(
    'учитель смотрит — приложение ученика просят присылать миниатюры',
    asked.at(-1) === true,
    JSON.stringify(asked),
  );
  await teacher.waitForSelector('.tile img.thumb', { timeout: 6000 });
  check('миниатюра экрана видна на плитке учителя', true);
  await teacher
    .locator('.tile')
    .first()
    .screenshot({ path: `${S}/63-h5-tile.png` });

  // A screenshot asked by the teacher.
  await teacher.locator('button:has-text("Снимок экрана у всех")').click();
  await wait(1000);
  const shots = await pc.evaluate(() =>
    window.__toHost.filter((m) => m.type === 'screenshot').map((m) => m.reason),
  );
  check(
    '«Снимок экрана у всех» доходит до приложения',
    shots.includes('manual'),
    JSON.stringify(shots),
  );

  // Leaving the practice photographs it again; then the results show the picture.
  for (let i = 0; i < 3; i++) {
    await teacher.locator('button:has-text("Пропустить")').click();
    await wait(250);
  }
  await wait(5600);
  await teacher.locator('button:has-text("Пропустить")').click();
  await wait(1200);
  const all = await pc.evaluate(() =>
    window.__toHost.filter((m) => m.type === 'screenshot').map((m) => m.reason),
  );
  check('конец практики — снимок сам', all.includes('stage_end'), JSON.stringify(all));

  await teacher.locator('button:has-text("Завершить урок")').click();
  await teacher.waitForURL('**/results');
  await teacher.waitForSelector('.gallery img', { timeout: 6000 });
  const loaded = await teacher
    .locator('.gallery img')
    .first()
    .evaluate((img) => img.complete && img.naturalWidth > 0);
  check('снимок экрана в галерее итогов', loaded);
  await teacher.screenshot({ path: `${S}/64-h5-gallery.png`, fullPage: true });

  const off = await pc.evaluate(() =>
    window.__toHost.filter((m) => m.type === 'thumbs').map((m) => m.on),
  );
  check('урок окончен — миниатюры больше не просят', off.at(-1) === false, JSON.stringify(off));

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
