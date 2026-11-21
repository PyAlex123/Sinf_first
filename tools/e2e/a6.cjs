// A6 (STAGE5.md): a link into the school — the administrator makes it; a new teacher opens it,
// registers, comes back and joins with one button; the link counts them; revoked, it stops.
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
  const admin = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  admin.on('console', (m) => m.type() === 'error' && errors.push(`админ: ${m.text()}`));
  admin.on('dialog', (d) => void d.accept());
  await admin.goto(`${BASE}/teacher/login`);
  await admin.fill('input[type=email]', 'demo@sinf.local');
  await admin.fill('input[type=password]', 'demo1234');
  await admin.click('button[type=submit]');
  await admin.waitForURL(`${BASE}/teacher`);

  await admin.goto(`${BASE}/school/school-demo#teachers`);
  await admin.locator('button:has-text("Создать ссылку")').click();
  await admin.waitForSelector('input[data-invite-link]');
  const link = await admin.inputValue('input[data-invite-link]');
  check('ссылка создана', /\/invite\/[A-Za-z0-9_-]{40,}$/.test(link), link.replace(/[^/]+$/, '…'));
  await admin.screenshot({ path: `${S}/a6-admin.png` });

  // A new teacher, not signed in, opens it.
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  await teacher.goto(link);
  await teacher.waitForSelector('[data-invite-school]');
  check(
    'по ссылке видно, в какую школу зовут',
    (await teacher.locator('[data-invite-school]').innerText()).includes('Demo School'),
  );
  await teacher.locator('a:has-text("Зарегистрироваться")').click();
  await teacher.waitForURL(/\/teacher\/register\?next=/);
  await teacher.fill('input[autocomplete=name]', 'Новая Учительница');
  await teacher.fill('input[type=email]', 'newbie@example.com');
  await teacher.fill('input[type=password]', 'newbie-pass-1');
  await teacher.click('button[type=submit]');
  await teacher.waitForURL(/\/invite\//);
  check('после регистрации — обратно к приглашению', true);
  await teacher.locator('button:has-text("Вступить в школу")').click();
  await teacher.waitForURL(`${BASE}/school/school-demo`);
  check('вступила одной кнопкой — открылась страница школы', true);
  await teacher.screenshot({ path: `${S}/a6-joined.png` });

  await admin.reload();
  await admin.waitForSelector('[data-invite]');
  check(
    'у ссылки счётчик «вошёл 1»',
    (await admin.locator('[data-invite]').innerText()).includes('вошёл 1'),
  );
  check(
    'учительница в списке учителей, без заявки',
    (await admin.locator('text=Новая Учительница').count()) > 0 &&
      (await admin.locator('button:has-text("Принять")').count()) === 0,
  );

  await admin.locator('[data-invite] button:has-text("Отозвать")').click();
  await admin.waitForSelector('[data-invite]', { state: 'detached' });
  const late = await (await browser.newContext()).newPage();
  await late.goto(link);
  await late.waitForSelector('h1');
  check(
    'отозванная ссылка не работает',
    (await late.locator('h1').innerText()).includes('Ссылка не работает'),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
