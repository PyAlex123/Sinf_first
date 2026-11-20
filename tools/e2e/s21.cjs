const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') =>
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // --- the demo teacher: his class and a running lesson
  const demo = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  let probing = false; // my own deliberate 404 probes must not count as page errors
  demo.on('console', (m) => m.type() === 'error' && errors.push(`демо: ${m.text()}`));
  await demo.goto(`${BASE}/teacher/login`);
  await demo.fill('input[type=email]', 'demo@sinf.local');
  await demo.fill('input[type=password]', 'demo1234');
  await demo.click('button[type=submit]');
  await demo.waitForURL('**/teacher');
  await demo.waitForSelector('h2:has-text("Уроки")', { timeout: 10000 });
  check(
    'демо-учитель видит свой класс',
    await demo.locator('h1', { hasText: 'Класс 1А' }).isVisible(),
  );
  const me = await demo.evaluate(async () => (await fetch('/api/me')).json());
  const classId = me.classes[0].id;

  // --- a brand new teacher registers from the public site
  const fresh = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  fresh.on('console', (m) => m.type() === 'error' && !probing && errors.push(`новый: ${m.text()}`));
  await fresh.goto(`${BASE}/teacher/login`);
  await fresh.click('a[href="/teacher/register"]');
  await fresh.waitForURL('**/teacher/register');
  const email = `uchitel${Date.now()}@example.com`;
  await fresh.fill('input[autocomplete=name]', 'Новый Учитель');
  await fresh.fill('input[type=email]', email);
  await fresh.fill('input[type=password]', 'parol12345');
  await fresh.click('button[type=submit]');
  await fresh.waitForURL('**/teacher', { timeout: 10000 });
  check('после регистрации учитель попадает в своё пространство', fresh.url().endsWith('/teacher'));
  await fresh.waitForSelector('h2:has-text("Уроки")', { timeout: 10000 });
  check(
    'у нового учителя нет чужих классов',
    await fresh.locator('h1', { hasText: 'У вас пока нет классов' }).isVisible(),
  );
  check(
    'чужой класс 1А не виден',
    !(await fresh
      .locator('text=Класс 1А')
      .isVisible()
      .catch(() => false)),
  );

  // --- and cannot reach the other teacher's data by url
  probing = true;
  const direct = await fresh.evaluate(async (id) => {
    const r = await fetch(`/api/classes/${id}`);
    return r.status;
  }, classId);
  check('запрос чужого класса даёт 404', direct === 404, `код ${direct}`);
  await fresh.goto(`${BASE}/teacher/class/${classId}/cards`);
  await fresh.waitForTimeout(800);
  const leaked = await fresh
    .locator('text=Алиев')
    .isVisible()
    .catch(() => false);
  check('страница карточек чужого класса не показывает учеников', !leaked);
  await fresh.screenshot({ path: `${S}/s21-fresh.png` });

  probing = false;

  // --- the demo teacher still works: starts a lesson and a student joins
  await demo.goto(`${BASE}/teacher`);
  await demo.click('text=Начать урок >> nth=0');
  await demo.waitForURL('**/teacher/session/**');
  const code = (await demo.locator('text=/Код урока: ?\\d{4}/').first().innerText()).match(
    /[0-9]{4}/,
  )[0];
  const details = await demo.evaluate(
    async (id) => (await fetch(`/api/classes/${id}`)).json(),
    classId,
  );
  const who = details.students[0];
  const pupil = await (await browser.newContext()).newPage();
  await pupil.goto(`${BASE}/join?code=${code}`);
  await pupil.waitForSelector('.names button');
  const lookup = await pupil.evaluate(
    async (c) =>
      (
        await fetch('/api/join/lookup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: c }),
        })
      ).json(),
    code,
  );
  await pupil.locator('.names button', { hasText: who.lastName }).first().click();
  await pupil.waitForSelector('.choice');
  for (const key of who.code) {
    await pupil.locator('.choice').nth(lookup.codePics.indexOf(key)).click();
    await pupil.waitForTimeout(120);
  }
  await pupil.waitForSelector('text=Начать', { timeout: 8000 });
  check('ученик по-прежнему входит по коду', true);

  // --- the outsider still cannot see that session
  const sessionId = demo.url().split('/').pop();
  probing = true;
  const peek = await fresh.evaluate(
    async (id) => (await fetch(`/api/sessions/${id}`)).status,
    sessionId,
  );
  probing = false;
  check('чужой урок не открывается', peek === 404, `код ${peek}`);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
  process.exit(out.some((l) => l.startsWith('❌')) ? 1 : 0);
})();
