const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') =>
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`) && pass;

(async () => {
  const browser = await chromium.launch();
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForURL('**/teacher');
  await teacher.click('text=Начать урок >> nth=0');
  await teacher.waitForURL('**/teacher/session/**');
  const code = (await teacher.locator('text=/Код урока: ?\\d{4}/').first().innerText()).match(
    /[0-9]{4}/,
  )[0];

  const me = await teacher.evaluate(async () => (await fetch('/api/me')).json());
  const details = await teacher.evaluate(
    async (id) => (await fetch(`/api/classes/${id}`)).json(),
    me.classes[0].id,
  );
  const who = details.students[0];
  const page = await (
    await browser.newContext({ viewport: { width: 1024, height: 768 } })
  ).newPage();
  await page.goto(`${BASE}/join?code=${code}`);
  await page.waitForSelector('.names button');
  const lookup = await page.evaluate(
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
  await page.locator('.names button', { hasText: who.lastName }).first().click();
  await page.waitForSelector('.choice');
  for (const key of who.code) {
    await page.locator('.choice').nth(lookup.codePics.indexOf(key)).click();
    await page.waitForTimeout(120);
  }
  await page.waitForSelector('text=Начать');
  await page.locator('text=Начать').first().click();
  await page.waitForTimeout(600);

  // free mode: the student walks through the stage himself
  await teacher.locator('button:has-text("Свободно")').first().click();
  await page.waitForTimeout(400);
  const at = () => page.evaluate(() => document.querySelector('.count')?.textContent ?? '');
  const start = await at();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const moved = await at();
  check('в «Свободно» стрелка листает урок', start !== moved, `${start} → ${moved}`);

  // now lock him: the same key must do nothing
  await teacher.locator('.tile >> nth=0').locator('.act').first().click();
  await page.waitForSelector('.lock');
  const beforeLock = await at();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check(
    'за шторкой «Внимание!» стрелки не листают',
    beforeLock === (await at()),
    `${beforeLock} → ${await at()}`,
  );

  await teacher.locator('.tile >> nth=0').locator('.act').first().click();
  await page.waitForTimeout(400);
  // Back, not forward: the stage may end here, and in free mode the range is bounded by the stage (S1.9).
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  check(
    'после снятия листание снова работает',
    beforeLock !== (await at()),
    `${beforeLock} → ${await at()}`,
  );

  await teacher.screenshot({ path: `${S}/s110-panel.png` });
  console.log(out.join('\n'));
  await browser.close();
  process.exit(out.some((l) => l.startsWith('❌')) ? 1 : 0);
})();
