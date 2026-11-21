// A8 (STAGE5.md): cards with a QR. A class of nine with digit codes prints on two A4 sheets, eight
// cards to a sheet, each with a QR; the QR opens "Мои работы" from home with the class and the name
// ready. A picture-code card's QR opens the lesson's entrance, and after the lesson code the child
// is straight at their own pictures.
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
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
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForURL(`${BASE}/teacher`);

  const cls = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const { class: c } = await json('POST', '/api/classes', { name: '5Д', grade: 5 });
    const names = [
      'Юсупов Сардор',
      'Ахмедова Нигора',
      'Каримов Бобур',
      'Ли Анна',
      'Петров Иван',
      'Рашидова Дилноза',
      'Сидоров Олег',
      'Туйчиев Жамшид',
      'Усмонова Малика',
    ];
    await json('POST', `/api/classes/${c.id}/students`, {
      students: names.map((n) => ({ lastName: n.split(' ')[0], firstName: n.split(' ')[1] })),
    });
    const d = await json('GET', `/api/classes/${c.id}`);
    return {
      id: c.id,
      homeCode: d.class.homeCode,
      kid: d.students.find((s) => s.lastName === 'Юсупов'),
    };
  });

  await teacher.goto(`${BASE}/teacher/class/${cls.id}/cards`);
  await teacher.waitForSelector('.card');
  const qrs = await teacher.locator('[data-qr]').evaluateAll((els) => els.map((e) => e.dataset.qr));
  check(
    'на каждой из 9 карточек — QR',
    qrs.length === 9 && (await teacher.locator('.card svg').count()) >= 9,
  );
  const mine = qrs.find((q) => q.includes(encodeURIComponent(cls.kid.id)));
  check(
    'QR класса с цифрами — «Мои работы» с кодом класса',
    mine === `${BASE}/my?c=${cls.homeCode}&s=${encodeURIComponent(cls.kid.id)}`,
    mine,
  );

  await teacher.emulateMedia({ media: 'print' });
  const pdf = await teacher.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${S}/a8-cards.pdf`, pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  check('9 карточек — 2 листа A4 (по 8 на лист)', pages === 2, `${pages} стр.`);
  await teacher.emulateMedia({ media: 'screen' });
  await teacher.screenshot({ path: `${S}/a8-cards.png`, fullPage: true });

  // The child scans the card at home.
  const phone = await (
    await browser.newContext({ viewport: { width: 414, height: 860 } })
  ).newPage();
  phone.on(
    'console',
    (m) =>
      m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`дома: ${m.text()}`),
  );
  await phone.goto(mine);
  await phone.waitForSelector('.digit');
  // The class code and the name are behind: the page greets the child and asks for the own code.
  check(
    'по QR дома — сразу ввод своего кода',
    (await phone.locator('h1').innerText()).includes('Сардор') &&
      (await phone.locator('input[aria-label="Код класса"]').count()) === 0,
  );
  for (const d of cls.kid.code)
    await phone.locator('.digit', { hasText: new RegExp(`^${d}$`) }).click();
  await phone.waitForSelector('text=Юсупов Сардор · 5Д');
  check('свой код — и своя папка', true);

  // A picture-code card (1А): the lesson's entrance; after the lesson code, the child's pictures.
  const lesson = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'g10',
    });
    return session.joinCode;
  });
  await teacher.goto(`${BASE}/teacher/class/class-1a/cards`);
  await teacher.waitForSelector('[data-qr]');
  await teacher.emulateMedia({ media: 'print' });
  const pdf1a = await teacher.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${S}/a8-cards-1a.pdf`, pdf1a);
  const pages1a = (pdf1a.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  check('класс с картинками: 20 карточек — 3 листа', pages1a === 3, `${pages1a} стр.`);
  await teacher.emulateMedia({ media: 'screen' });
  const card = await teacher
    .locator('.card', { hasText: 'Алиев Тимур' })
    .locator('[data-qr]')
    .getAttribute('data-qr');
  check('QR класса с картинками — вход в урок', /\/join\?s=/.test(card ?? ''), card ?? '');
  const tablet = await (
    await browser.newContext({ viewport: { width: 1024, height: 768 } })
  ).newPage();
  tablet.on('console', (m) => m.type() === 'error' && errors.push(`планшет: ${m.text()}`));
  await tablet.goto(card);
  await tablet.waitForSelector('input.code');
  await tablet.fill('input.code', lesson);
  await tablet.locator('button[type=submit]').click();
  await tablet.waitForSelector('h1:has-text("Тимур")');
  check(
    'после кода урока — сразу свои картинки, без списка класса',
    (await tablet.locator('.names button').count()) === 0,
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
