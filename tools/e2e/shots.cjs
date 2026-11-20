const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const out = process.argv[2];
const fs = require('node:fs');
fs.mkdirSync(out, { recursive: true });

async function shot(page, name, width = 1366, height = 820) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 820 },
    deviceScaleFactor: 1,
  });
  const p = await ctx.newPage();

  await p.goto(`${BASE}/`);
  await p.waitForTimeout(400);
  await shot(p, '01-home');
  await p.goto(`${BASE}/teacher/login`);
  await p.waitForSelector('form');
  await shot(p, '02-login');
  await p.goto(`${BASE}/teacher/register`);
  await p.waitForSelector('form');
  await shot(p, '03-register');

  await p.goto(`${BASE}/teacher/login`);
  await p.fill('input[type=email]', 'demo@sinf.local');
  await p.fill('input[type=password]', 'demo1234');
  await p.click('button[type=submit]');
  await p.waitForURL('**/teacher');
  await p.waitForSelector('h1');
  await shot(p, '04-dashboard');

  const me = await p.evaluate(async () => await (await fetch('/api/me')).json());
  const classId = me.classes[0].id;
  const schoolId = me.schools[0].id;

  await p.goto(`${BASE}/teacher/class/${classId}`);
  await p.waitForSelector('tbody tr');
  await shot(p, '05-class');
  await p.goto(`${BASE}/teacher/class/${classId}/cards`);
  await p.waitForSelector('article.card');
  await shot(p, '06-cards');

  // школа + компьютер
  await p.goto(`${BASE}/school/${schoolId}`);
  await p.waitForSelector('h1');
  if (await p.locator('input[placeholder="ПК-05"]').count()) {
    await p.fill('input[placeholder="ПК-05"]', 'ПК-05');
    await p.fill('input[placeholder="Кабинет 204"]', 'Кабинет 204');
    await p.click('button:has-text("Добавить компьютер")');
    await p.waitForSelector('code.pair').catch(() => {});
  }
  await shot(p, '07-school');
  await p.goto(`${BASE}/teacher/schools`);
  await p.waitForSelector('h1');
  await shot(p, '08-schools');
  await p.goto(`${BASE}/admin`);
  await p.waitForTimeout(600);
  await shot(p, '09-admin');

  // урок
  await p.goto(`${BASE}/teacher`);
  await p.waitForSelector('h1');
  await p.click('text=Начать урок >> nth=0');
  await p.waitForURL('**/teacher/session/**');
  await p.waitForTimeout(900);
  await shot(p, '10-session');
  const sessionId = p.url().split('/').pop();
  const code = (await p.locator('text=/Код урока: ?[0-9]{4}/').first().innerText()).match(
    /[0-9]{4}/,
  )[0];

  const proj = await ctx.newPage();
  await proj.goto(`${BASE}/present/${sessionId}`);
  await proj.waitForTimeout(900);
  await shot(proj, '11-projector');

  // ученик: вход и урок
  const details = await p.evaluate(
    async (id) => await (await fetch(`/api/classes/${id}`)).json(),
    classId,
  );
  const who = details.students[0];
  const pupilCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pupil = await pupilCtx.newPage();
  await pupil.goto(`${BASE}/join?code=${code}`);
  await pupil.waitForSelector('.names button');
  await shot(pupil, '12-join-names', 390, 844);
  const lookup = await pupil.evaluate(
    async (c) =>
      await (
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
  await shot(pupil, '13-join-code', 390, 844);
  for (const key of who.code) {
    await pupil.locator('.choice').nth(lookup.codePics.indexOf(key)).click();
    await pupil.waitForTimeout(120);
  }
  await pupil.waitForSelector('text=Начать');
  await shot(pupil, '14-student-start', 390, 844);
  await pupil.locator('text=Начать').first().click();
  await pupil.waitForTimeout(900);
  await shot(pupil, '15-student-lesson', 390, 844);

  // панель урока с учеником + телефонная главная
  await p.reload();
  await p.waitForTimeout(1200);
  await shot(p, '16-session-with-student');
  await p.goto(`${BASE}/teacher`);
  await p.waitForSelector('h1');
  await shot(p, '17-dashboard-phone', 390, 844);
  await p.goto(`${BASE}/teacher/class/${classId}`);
  await p.waitForSelector('tbody tr');
  await shot(p, '18-class-phone', 390, 844);

  await browser.close();
  console.log('снимки в', out);
})();
