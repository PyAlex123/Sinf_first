const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (n, ok, extra = '') =>
  out.push(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`);

/** Как это делает приложение на школьном ПК: обычный HTTP, без браузера. */
async function appPair(code) {
  const r = await fetch(`${BASE}/api/devices/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, appVersion: '0.1.0', platform: 'Windows 11' }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function appHeartbeat(token, version) {
  const r = await fetch(`${BASE}/api/devices/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${token}` },
    body: JSON.stringify(version ? { appVersion: version } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForURL('**/teacher');
  await page.waitForSelector('h1');
  await page.click('a[href^="/school/"]');
  await page.waitForURL('**/school/**');
  await page.waitForSelector('h2:has-text("Компьютеры школы")');

  // директор добавляет компьютер
  await page.fill('input[placeholder="ПК-05"]', 'ПК-05');
  await page.fill('input[placeholder="Кабинет 204"]', 'Кабинет 204');
  await page.click('button:has-text("Добавить компьютер")');
  await page.waitForSelector('code.pair', { timeout: 10000 });
  const code = (await page.locator('code.pair').first().innerText()).trim();
  check('код привязки показан директору', /^[A-Z0-9]{6}$/.test(code), code);
  check(
    'машина помечена как ждущая',
    (await page.locator('tr:has-text("ждёт кода")').count()) === 1,
  );

  // приложение привязывается этим кодом
  const paired = await appPair(code);
  check(
    'приложение привязалось по коду',
    paired.status === 200 && paired.body.school.name === 'Demo School',
    `код ответа ${paired.status}`,
  );
  const token = paired.body.deviceToken;

  // тот же код второй раз не работает
  const second = await appPair(code);
  check(
    'повторная привязка тем же кодом отклонена',
    second.status === 404,
    `код ответа ${second.status}`,
  );

  // отклик обновляет версию и время
  const beat = await appHeartbeat(token, '0.2.0');
  check('приложение отчиталось', beat.status === 200 && beat.body.name === 'ПК-05');

  await page.reload();
  await page.waitForSelector('h2:has-text("Компьютеры школы")');
  const row = await page.locator('tr:has-text("ПК-05")').innerText();
  check(
    'школа видит машину на связи и её версию',
    row.includes('на связи') && row.includes('0.2.0'),
    row.replace(/\s+/g, ' ').slice(0, 80),
  );
  check('кода у привязанной машины больше нет', (await page.locator('code.pair').count()) === 0);
  await page.screenshot({ path: `${S}/s24-devices.png` });

  // отвязка: токен перестаёт работать
  page.on('dialog', (d) => d.accept());
  await page
    .locator('tr:has-text("ПК-05")')
    .locator('button:has-text("Отвязать и выдать код")')
    .click();
  await page.waitForSelector('code.pair', { timeout: 10000 });
  const after = await appHeartbeat(token);
  check(
    'после отвязки старый токен не работает',
    after.status === 401,
    `код ответа ${after.status}`,
  );

  // удаление машины
  await page.locator('tr:has-text("ПК-05")').locator('button:has-text("Удалить")').click();
  await page.waitForTimeout(900);
  check('машина удалена из школы', (await page.locator('tr:has-text("ПК-05")').count()) === 0);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
  process.exit(out.some((l) => l.startsWith('❌')) ? 1 : 0);
})();
