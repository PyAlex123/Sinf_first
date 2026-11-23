// B10 (STAGE6.md): the landing page and the pilot request. On the platform (the server without
// CLASSROOM_MODE, with SUPERADMIN_EMAIL=root@sinf.uz and SUPERADMIN_PASSWORD=root-pass-1234) `/` is
// the landing page in three languages; its buttons lead to sign-up and to the student's way in; a
// school sends a pilot request and the superadmin sees it in /admin. With CLASSROOM=1 in the
// environment the script instead checks that a classroom server keeps the plain front page.
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

  if (process.env.CLASSROOM === '1') {
    await page.goto(`${BASE}/`);
    await page.waitForSelector('a:has-text("Я ученик")');
    check(
      'сервер класса: на главной — простая страница с кнопками',
      (await page.locator('#pilot').count()) === 0,
    );
    const sent = await page.evaluate(
      async () =>
        (
          await fetch('/api/pilot-requests', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ school: 'x', city: 'x', name: 'x', contact: 'x' }),
          })
        ).status,
    );
    check('сервер класса заявок не принимает', sent === 404, String(sent));
    // That refusal is a 404 the browser logs; nothing else may be there.
    const real = errors.filter((e) => !e.includes('status of 404'));
    check('других ошибок в консоли нет', real.length === 0, real.join(' | '));
    console.log(out.join('\n'));
    await browser.close();
    return;
  }

  await page.goto(`${BASE}/`);
  await page.waitForSelector('h1:has-text("Уроки информатики")');
  check('на сайте главная — лендинг', (await page.locator('#features .card').count()) === 5);
  check(
    '«Начать бесплатно» ведёт на регистрацию учителя',
    (await page.locator('.hero a:has-text("Начать бесплатно")').getAttribute('href')) ===
      '/teacher/register',
  );
  check(
    '«Я ученик» ведёт ко входу ученика',
    (await page.locator('header a:has-text("Я ученик")').getAttribute('href')) === '/join',
  );
  check(
    'цен нет — «по заявке»',
    (await page.locator('#pricing').innerText()).includes('по заявке'),
  );
  await page.screenshot({ path: `${S}/b10-landing-ru.png` });

  await page.click('.lang-full button:has-text("O‘zbekcha")');
  await page.waitForSelector('h1:has-text("Kompyuter sinfida")');
  check('по-узбекски', true);
  await page.click('.lang-full button:has-text("English")');
  await page.waitForSelector('h1:has-text("Computer science lessons")');
  check('по-английски', true);
  await page.click('.lang-full button:has-text("Русский")');
  await page.waitForSelector('h1:has-text("Уроки информатики")');

  // The FAQ opens.
  await page.click('summary:has-text("Что если на уроке пропал интернет?")');
  check(
    'вопросы раскрываются',
    await page.locator('details[open] p:has-text("Урок продолжается")').isVisible(),
  );

  // A school asks for a pilot.
  await page.click('.hero a:has-text("Заявка на пилот")');
  await page.fill('[data-field=school]', 'Школа № 12');
  await page.fill('[data-field=city]', 'Ташкент');
  await page.fill('[data-field=name]', 'Каримова Дилноза, завуч');
  await page.fill('[data-field=contact]', '+998 90 123 45 67');
  await page.fill('[data-field=classes]', '4');
  await page.fill('[data-field=comment]', 'Хотим на 7-х классах');
  await page.click('button:has-text("Отправить заявку")');
  await page.waitForSelector('[data-pilot=sent]');
  check('заявка отправлена — «Спасибо!»', true);
  await page.screenshot({ path: `${S}/b10-pilot-sent.png` });

  // The superadmin sees it.
  const admin = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  await admin.goto(`${BASE}/teacher/login`);
  await admin.fill('input[type=email]', 'root@sinf.uz');
  await admin.fill('input[type=password]', 'root-pass-1234');
  await admin.click('button[type=submit]');
  await admin.waitForURL(`${BASE}/teacher`);
  await admin.goto(`${BASE}/admin`);
  const row = admin.locator('[data-pilot-request="Школа № 12"]');
  await row.waitFor();
  const text = await row.innerText();
  check(
    'суперадмин видит заявку: школа, контакт, классы, комментарий',
    text.includes('+998 90 123 45 67') &&
      text.includes('классов: 4') &&
      text.includes('Хотим на 7-х'),
    text.replace(/\s+/g, ' '),
  );
  await row.locator('button:has-text("Обработано")').click();
  await admin.waitForSelector(
    '[data-pilot-request="Школа № 12"] button:has-text("Вернуть в новые")',
  );
  check('заявку можно отметить обработанной', true);

  // On a phone nothing sticks out sideways.
  const phone = await (
    await browser.newContext({ viewport: { width: 390, height: 844 } })
  ).newPage();
  await phone.goto(`${BASE}/`);
  await phone.waitForSelector('#pilot');
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check('на телефоне ничего не вылезает вбок', overflow === 0, `${overflow} px`);
  await phone.screenshot({ path: `${S}/b10-landing-phone.png` });

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
