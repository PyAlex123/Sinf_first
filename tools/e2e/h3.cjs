// H3 (STAGE3.md): the web half of the kiosk. With the Windows app's bridge injected (role "student"),
// only the way into the lesson and the lesson itself open — whatever the child tries.
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (await browser.newContext()).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => {
    window.sinfHost = { isDesktop: true, role: 'student', version: '0.1.0.0', pcName: 'ПК-05' };
  });

  await page.goto(`${BASE}/join`);
  await page.waitForSelector('.top');
  check('«Sinf» в углу — не ссылка', (await page.locator('.top a.home').count()) === 0);

  for (const path of ['/', '/teacher/login', '/teacher', '/present/abc', '/teacher/demo']) {
    await page.goto(`${BASE}${path}`);
    await page
      .waitForFunction(() => location.pathname === '/join', null, { timeout: 5000 })
      .catch(() => undefined);
    const now = new URL(page.url()).pathname;
    check(`заход на ${path} возвращает ко входу`, now === '/join', now);
  }

  // A link inside the app never reaches the Windows filter: the router must hold the line itself.
  await page.evaluate(() => {
    history.pushState(null, '', '/teacher/login');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(500);
  check(
    'переход внутри приложения тоже возвращает ко входу',
    new URL(page.url()).pathname === '/join',
  );

  const plain = await (await browser.newContext()).newPage();
  await plain.goto(`${BASE}/teacher/login`);
  await plain.waitForSelector('input[type=email]');
  check('в обычном браузере страница учителя открывается', true);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
