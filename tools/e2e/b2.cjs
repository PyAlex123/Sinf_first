// B2 (STAGE6.md): licenses. The superadmin sees the demo school's license, takes it back and gives
// one for a single class; the school's administrator sees it on the overview; a teacher who tries a
// second class of the school is told why not. The server must run with SUPERADMIN_EMAIL=root@sinf.uz
// and SUPERADMIN_PASSWORD=root-pass-1234.
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

async function login(browser, email, password) {
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/teacher`);
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const root = await login(browser, 'root@sinf.uz', 'root-pass-1234');
  root.on('console', (m) => m.type() === 'error' && errors.push(`суперадмин: ${m.text()}`));
  root.on('dialog', (d) => void d.accept());
  await root.goto(`${BASE}/admin`);
  const demo = root.locator('[data-license="Demo School"]');
  await demo.waitFor();
  check(
    'у демо-школы лицензия действует',
    (await demo.innerText()).includes('действует'),
    (await demo.innerText()).replace(/\s+/g, ' '),
  );

  await demo.locator('button:has-text("Лицензия…")').click();
  await root.locator('button:has-text("Отозвать")').first().click();
  await root.waitForFunction(() =>
    /нет лицензии/.test(document.querySelector('[data-license="Demo School"]')?.textContent ?? ''),
  );
  check('отозвана — «нет лицензии»', true);
  const today = new Date().toISOString().slice(0, 10);
  await root.fill('input[data-field=license-limit]', '1');
  await root.fill('input[data-field=license-from]', today);
  await root.fill('input[data-field=license-to]', `${Number(today.slice(0, 4)) + 1}-05-31`);
  await root.locator('button:has-text("Выдать")').click();
  await root.waitForFunction(() =>
    /классов 1 из 1/.test(
      document.querySelector('[data-license="Demo School"]')?.textContent ?? '',
    ),
  );
  check('выдана на 1 класс — «классов 1 из 1»', true);
  await root.screenshot({ path: `${S}/b2-admin.png`, fullPage: true });

  const teacher = await login(browser, 'demo@sinf.local', 'demo1234');
  teacher.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !/status of 409/.test(m.text()) &&
      errors.push(`учитель: ${m.text()}`),
  );
  await teacher.goto(`${BASE}/school/school-demo`);
  await teacher.waitForSelector('[data-license-state]');
  check(
    'на обзоре школы — лицензия действует',
    (await teacher.locator('[data-license-state]').innerText()).includes('действует'),
  );

  await teacher.goto(`${BASE}/teacher`);
  await teacher.locator('button:has-text("Создать класс")').click();
  await teacher.fill('input[placeholder="5Б"]', '5Б');
  await teacher.locator('form button[type=submit]').click();
  await teacher.waitForSelector('.notice');
  const why = await teacher.locator('.notice').innerText();
  check('второй класс школы — понятный отказ', /заняла все 1 классов/.test(why), why);

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
