// A5 (STAGE5.md): the school's administrator panel — the overview (who is online, which computer
// lags behind), computers by room, a colleague assigned to a class; a plain teacher sees two tabs.
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
const json = (page, m, u, b) =>
  page.evaluate(
    ([m, u, b]) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json()),
    [m, u, b],
  );

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const admin = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  admin.on('console', (m) => m.type() === 'error' && errors.push(`админ: ${m.text()}`));
  await admin.goto(`${BASE}/teacher/login`);
  await admin.fill('input[type=email]', 'demo@sinf.local');
  await admin.fill('input[type=password]', 'demo1234');
  await admin.click('button[type=submit]');
  await admin.waitForURL(`${BASE}/teacher`);

  // Three computers: two in room 204 on different versions, one in 105 not paired yet.
  const machines = [
    ['ПК-01', 'Кабинет 204', '0.1.10.0'],
    ['ПК-02', 'Кабинет 204', '0.1.9.0'],
    ['ПК-03', 'Кабинет 105', null],
  ];
  for (const [name, room, version] of machines) {
    const { device } = await json(admin, 'POST', '/api/schools/school-demo/devices', {
      name,
      room,
      role: 'student',
    });
    if (version)
      await json(admin, 'POST', '/api/devices/pair', {
        code: device.pairingCode,
        appVersion: version,
      });
  }

  // A colleague asks to join; the administrator accepts.
  const colleague = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  colleague.on('console', (m) => m.type() === 'error' && errors.push(`коллега: ${m.text()}`));
  await colleague.goto(`${BASE}/teacher/register`);
  await colleague.fill('input[autocomplete=name]', 'Коллега Учитель');
  await colleague.fill('input[type=email]', 'colleague@example.com');
  await colleague.fill('input[type=password]', 'colleague-pass-1');
  await colleague.click('button[type=submit]');
  await colleague.waitForURL(`${BASE}/teacher`);
  await json(colleague, 'POST', '/api/schools/school-demo/requests');

  await admin.goto(`${BASE}/school/school-demo`);
  await admin.waitForSelector('[data-overview]');
  const overview = await admin.locator('[data-overview]').innerText();
  check('обзор: ПК в сети 2 из 3', /в сети 2 из 3/.test(overview), overview.replace(/\s+/g, ' '));
  check(
    'обзор: одна машина отстала по версии',
    /Старая версия: 1 — обновите до 0\.1\.10\.0/.test(overview),
  );
  check('обзор: заявка учителя видна', /Заявок: 1/.test(overview));
  await admin.screenshot({ path: `${S}/a5-overview.png` });

  await admin.locator('[data-old]').click();
  await admin.waitForSelector('[data-room]');
  const rooms = await admin
    .locator('[data-room]')
    .evaluateAll((hs) => hs.map((h) => h.dataset.room));
  check('компьютеры по кабинетам', rooms.join('|') === 'Кабинет 105|Кабинет 204', rooms.join('|'));
  check(
    'у отставшей машины пометка «старая»',
    (await admin.locator('tr[data-device="ПК-02"]').innerText()).includes('старая') &&
      !(await admin.locator('tr[data-device="ПК-01"]').innerText()).includes('старая'),
  );
  check('ссылка открывает вкладку в адресе', admin.url().endsWith('#computers'));
  await admin.screenshot({ path: `${S}/a5-computers.png`, fullPage: true });

  await admin.locator('[data-tab=teachers]').click();
  await admin.locator('button:has-text("Принять")').click();
  await admin.waitForSelector('text=Коллега Учитель');
  await admin.locator('[data-tab=classes]').click();
  await admin
    .locator('td[data-class="1А"]')
    .locator('xpath=..')
    .locator('button:has-text("Учителя класса")')
    .click();
  await admin.locator('.assign label:has-text("Коллега Учитель") input').check();
  await admin.locator('.assign button:has-text("Сохранить")').click();
  await admin.waitForSelector('.assign', { state: 'detached' });
  check(
    'коллега назначен учителем 1А',
    /Демо Учитель, Коллега Учитель|Коллега Учитель, Демо Учитель/.test(
      await admin.locator('td[data-class="1А"]').innerText(),
    ),
  );

  await colleague.goto(`${BASE}/school/school-demo`);
  await colleague.waitForSelector('[data-tab]');
  const tabs = await colleague
    .locator('[data-tab]')
    .evaluateAll((bs) => bs.map((b) => b.dataset.tab));
  check(
    'учителю — только «Учителя» и «Классы»',
    tabs.join(',') === 'teachers,classes',
    tabs.join(','),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
