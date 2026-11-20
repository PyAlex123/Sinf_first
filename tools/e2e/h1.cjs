// H1 (STAGE3.md): what a student computer's window sees. The Windows app injects window.sinfHost
// with role "student" and the computer's name; here the same object is injected into Chromium.
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  const student = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  student.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await student.addInitScript(() => {
    window.sinfHost = { isDesktop: true, role: 'student', version: '0.1.0.0', pcName: 'ПК-05' };
  });
  await student.goto(`${BASE}/join`);
  // On a classroom computer the page waits for the lesson (H2) rather than asking for a code.
  await student.waitForSelector('.top');
  const pc = await student
    .locator('.pc')
    .innerText()
    .catch(() => '');
  check('в окне ученика видно имя ПК', pc.trim() === 'ПК-05', pc);
  await student.screenshot({ path: `${__dirname}/out/60-h1-student-join.png` });

  const browserPage = await (await browser.newContext()).newPage();
  await browserPage.goto(`${BASE}/join`);
  await browserPage.waitForSelector('.codeform');
  check('в обычном браузере имени ПК нет', (await browserPage.locator('.pc').count()) === 0);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
