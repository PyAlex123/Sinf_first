// A2 (STAGE5.md): the school's limits on a child's folder — the administrator lowers the room and
// the largest file; in a lesson the page refuses a big file at once, with the school's number, and
// shows the smaller room.
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
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForURL(`${BASE}/teacher`);

  // The administrator: 3 MB a child, 1 MB a file.
  await teacher.goto(`${BASE}/school/school-demo#rules`);
  await teacher.fill('input[data-field=quota]', '3');
  await teacher.fill('input[data-field=max-file]', '1');
  await teacher
    .locator('input[data-field=quota]')
    .locator('xpath=ancestor::form')
    .locator('button[type=submit]')
    .click();
  await teacher.waitForSelector('[data-saved]');

  const { sessionId, token } = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const details = await json('GET', '/api/classes/class-1a');
    const s = details.students.find((x) => x.lastName === 'Алиев');
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'k10',
    });
    const joined = await json('POST', '/api/join', {
      sessionId: session.id,
      studentId: s.id,
      code: s.code,
    });
    return { sessionId: session.id, token: joined.token };
  });

  const kid = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  kid.on('console', (m) => m.type() === 'error' && errors.push(`ученик: ${m.text()}`));
  await kid.goto(`${BASE}/`);
  await kid.evaluate(
    ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
    [sessionId, token],
  );
  await kid.goto(`${BASE}/s/${sessionId}`);
  await kid.waitForSelector('button:has-text("Начать")', { timeout: 8000 });
  await kid.locator('button:has-text("Начать")').first().click();
  await kid.locator('button.filesbtn').click();
  await kid.waitForSelector('.filesover .usage');
  const used = await kid.locator('.filesover').innerText();
  check(
    'в папке видно место школы: 3 МБ',
    /из 3 МБ/.test(used),
    used.match(/Занято[^\n]*/)?.[0] ?? '',
  );

  const big = { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(1024 * 1024 + 10) };
  const ok = { name: 'ok.png', mimeType: 'image/png', buffer: Buffer.alloc(900 * 1024) };
  await kid.locator('.filesover input[type=file]').setInputFiles([big, ok]);
  await kid.waitForSelector('.filesover li:has-text("ok.png")');
  const notice = await kid.locator('.filesover .notice').innerText();
  check(
    'большой файл не принят, с числом школы',
    /big\.png: файл больше 1 МБ — столько разрешила школа/.test(notice),
    notice,
  );
  check(
    'файл в пределах принят',
    (await kid.locator('.filesover li:has-text("big.png")').count()) === 0,
  );
  await kid.screenshot({ path: `${S}/a2-folder.png` });

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
