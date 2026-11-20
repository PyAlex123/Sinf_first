// H8 (STAGE3.md): finishing touches of class control. The teacher corrects the seating on the class
// page by dragging a name, hears of a child who logged in on a second computer, sees one screen
// large and orders tiles the way the class sits. The Windows app is imitated in Chromium (as in h5).
// The server must run with CLASSROOM_MODE=1 and a fresh demo (`pnpm seed --reset`).
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
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`teacher: ${m.text()}`));
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")');
  const details = await teacher.evaluate(async () => (await fetch('/api/classes/class-1a')).json());
  const codeOf = (last) => details.students.find((s) => s.lastName === last).code;

  /** A classroom computer: the app's bridge plus a fake WebView2 channel that sends thumbnails. */
  async function computer(pcName) {
    const page = await (
      await browser.newContext({ viewport: { width: 1366, height: 768 } })
    ).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${pcName}: ${m.text()}`));
    await page.addInitScript((name) => {
      window.sinfHost = { isDesktop: true, role: 'student', version: '0.1.0.0', pcName: name };
      const listeners = [];
      const picture = () => {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 180;
        const g = c.getContext('2d');
        g.fillStyle = '#9cf';
        g.fillRect(0, 0, 320, 180);
        g.fillStyle = '#222';
        g.font = '40px sans-serif';
        g.fillText(name, 90, 105);
        return c.toDataURL('image/jpeg', 0.7).split(',')[1];
      };
      let timer = null;
      const emit = (data) => listeners.forEach((l) => l({ data }));
      window.chrome = window.chrome || {};
      window.chrome.webview = {
        postMessage: (m) => {
          if (m.type === 'thumbs') {
            clearInterval(timer);
            if (m.on) {
              emit({ type: 'thumb', jpeg: picture() });
              timer = setInterval(() => emit({ type: 'thumb', jpeg: picture() }), 3000);
            }
          }
        },
        addEventListener: (_t, l) => listeners.push(l),
        removeEventListener: (_t, l) => listeners.splice(listeners.indexOf(l), 1),
      };
    }, pcName);
    await page.goto(`${BASE}/join`);
    return page;
  }

  async function login(page, lastName) {
    await page.waitForSelector('.names button', { timeout: 8000 });
    await page.locator('.names button', { hasText: lastName }).click();
    const lookup = await page.evaluate(async () =>
      (await fetch(`/api/join/room?pc=${encodeURIComponent(window.sinfHost.pcName)}`)).json(),
    );
    const pics = lookup.lesson.codePics;
    for (const key of codeOf(lastName)) {
      await page.locator('.choice').nth(pics.indexOf(key)).click();
      await wait(120);
    }
    await page.waitForURL('**/s/**', { timeout: 10000 });
  }

  // ---------- a lesson seats two children
  await teacher.goto(`${BASE}/teacher`);
  await teacher
    .locator('.lcard', { hasText: 'Предыдущий — последующий' })
    .locator('button:has-text("Начать урок")')
    .click();
  await teacher.waitForURL('**/teacher/session/**');
  const sessionUrl = teacher.url();
  const pc12 = await computer('ПК-12');
  const pc5 = await computer('ПК-5');
  await login(pc12, 'Алиев');
  await login(pc5, 'Каримова');
  await teacher.waitForSelector('.tile:has-text("ПК-5")');

  // ---------- tiles the way the class sits
  const names = async () =>
    teacher.locator('.tile .tname').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  await teacher.locator('.order button:has-text("Как сидят")').click();
  const seated = await names();
  check(
    '«Как сидят»: ПК-5 раньше ПК-12',
    seated.findIndex((n) => n.includes('ПК-5')) < seated.findIndex((n) => n.includes('ПК-12')),
    seated.join(' | '),
  );
  await teacher.locator('.order button:has-text("По списку")').click();

  // ---------- one screen, large
  await teacher.waitForSelector('.tile:has-text("ПК-12") .act[aria-label="Экран крупно"]', {
    timeout: 10000,
  });
  await teacher.locator('.tile:has-text("ПК-12") .act[aria-label="Экран крупно"]').click();
  await teacher.waitForSelector('dialog.zoom[open] img.zimg');
  check('«Экран крупно» открывает экран ученика', true);
  await teacher.screenshot({ path: `${S}/81-h8-zoom.png` });
  await teacher.keyboard.press('Escape');
  await wait(200);
  check('Esc закрывает крупный экран', (await teacher.locator('dialog.zoom[open]').count()) === 0);

  // ---------- the same child on a second computer
  const pc7 = await computer('ПК-7');
  await login(pc7, 'Алиев');
  await teacher.waitForSelector('.moved:has-text("ПК-7")', { timeout: 8000 });
  const notice = await teacher.locator('.moved').first().textContent();
  check(
    'учитель видит «вошёл на другом компьютере»',
    notice.includes('Алиев') && notice.includes('ПК-12') && notice.includes('ПК-7'),
    notice.trim(),
  );
  await pc12.waitForSelector('text=Ты вошёл на другом устройстве', { timeout: 5000 });
  // The lesson still goes on, so the computer is back at the class list, nobody seated there now.
  await pc12.waitForSelector('.names button', { timeout: 10000 });
  check('первый ПК сам вернулся к входу и просит выбрать себя', true);
  await teacher.locator('.moved .act').first().click();
  check('уведомление закрывается', (await teacher.locator('.moved').count()) === 0);

  // ---------- the seating on the class page
  await teacher.goto(`${BASE}/teacher/class/class-1a`);
  await teacher.waitForSelector('#seats-title');
  const seatOf = async (pc) =>
    (await teacher.locator(`.pc[data-pc="${pc}"] .who`).textContent()).trim();
  check(
    'рассадка: ПК-5 — Каримова, ПК-7 — Алиев, ПК-12 свободен',
    (await seatOf('ПК-5')).includes('Каримова') &&
      (await seatOf('ПК-7')).includes('Алиев') &&
      (await seatOf('ПК-12')) === 'свободно',
  );
  await teacher.screenshot({ path: `${S}/82-h8-seats.png`, fullPage: true });
  await teacher.locator('.pc[data-pc="ПК-5"] .who').dragTo(teacher.locator('.pc[data-pc="ПК-7"]'));
  await wait(500);
  check(
    'перетаскивание меняет учеников местами',
    (await seatOf('ПК-5')).includes('Алиев') && (await seatOf('ПК-7')).includes('Каримова'),
  );
  await teacher.locator('.pc[data-pc="ПК-12"] select').selectOption({
    label:
      details.students.find((s) => s.lastName === 'Каримова').lastName +
      ' ' +
      details.students.find((s) => s.lastName === 'Каримова').firstName,
  });
  await wait(500);
  await teacher.reload();
  await teacher.waitForSelector('#seats-title');
  check(
    'выбор в списке и перезагрузка: ПК-12 — Каримова, ПК-7 свободен',
    (await seatOf('ПК-12')).includes('Каримова') && (await seatOf('ПК-7')) === 'свободно',
  );

  // ---------- the next lesson greets by the corrected seating
  await teacher.goto(sessionUrl);
  await teacher.locator('button:has-text("Завершить урок")').click();
  await teacher.waitForURL('**/results');
  await pc12.waitForSelector('.waiting', { timeout: 10000 });
  await teacher.goto(`${BASE}/teacher`);
  await teacher
    .locator('.lcard', { hasText: 'Предыдущий — последующий' })
    .locator('button:has-text("Начать урок")')
    .click();
  await teacher.waitForURL('**/teacher/session/**');
  await pc12.waitForSelector('text=Привет, Мадина!', { timeout: 8000 });
  check('следующий урок: ПК-12 здоровается с Мадиной по исправленной рассадке', true);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
