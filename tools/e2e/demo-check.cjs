const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(`${BASE}/teacher/login`);
  await p.fill('input[type=email]', 'demo@sinf.local');
  await p.fill('input[type=password]', 'demo1234');
  await p.click('button[type=submit]');
  await p.waitForURL('**/teacher');
  await p.waitForSelector('h1:has-text("1А")', { timeout: 10000 });
  console.log('✅ демо-учитель видит класс 1А');
  await p.click('a:has-text("Ученики класса")');
  await p.waitForSelector('h1:has-text("1А")');
  await p.waitForSelector('tbody tr');
  const rows = await p.locator('tbody tr').count();
  const pics = await p.locator('tbody tr .pic svg').count();
  console.log(`✅ в демо-классе ${rows} учеников, картинок кода ${pics}`);
  await p.screenshot({ path: `${S}/s22-class.png`, fullPage: false });
  await p.goto(`${BASE}/teacher`);
  await p.waitForSelector('h1');
  await p.click('text=Начать урок >> nth=0');
  await p.waitForURL('**/teacher/session/**');
  console.log('✅ урок демо-класса запускается');
  console.log(
    errors.length === 0
      ? '✅ ошибок в консоли нет'
      : `❌ ошибки: ${errors.slice(0, 2).join(' | ')}`,
  );
  await b.close();
})();
