// A7 (STAGE5.md): a forgotten password. By mail: "Забыли пароль?" → the letter (no SMTP here: it is
// in the server's log) → a new password → signed in, while a login left open elsewhere ends. By an
// administrator: a link for a teacher of the school, opened by that teacher.
// The server's log is read from LOG (default /tmp/claude-0/e2e-server.log).
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const LOG = process.env.LOG ?? '/tmp/claude-0/e2e-server.log';
const S = join(__dirname, 'out');
mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * The link of the last letter to this address, from the server's log — written as JSON lines in
 * production, as pretty text by `pnpm start` here; the address and the link are found either way.
 */
function letterLink(to) {
  const blocks = readFileSync(LOG, 'utf8').split('letter (no SMTP)').slice(1).reverse();
  for (const block of blocks) {
    const head = block.slice(0, 2000);
    if (!head.includes(`"${to}"`)) continue;
    const m = /(https?:\/\/[^\s"\\]+\/teacher\/reset\/[A-Za-z0-9_-]+)/.exec(head);
    if (m) return m[1];
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) =>
    page.on('console', (m) => m.type() === 'error' && errors.push(`${who}: ${m.text()}`));

  // A login left open at school.
  const school = await (await browser.newContext()).newPage();
  await school.goto(`${BASE}/teacher/login`);
  await school.fill('input[type=email]', 'demo@sinf.local');
  await school.fill('input[type=password]', 'demo1234');
  await school.click('button[type=submit]');
  await school.waitForURL(`${BASE}/teacher`);

  const home = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  watch(home, 'дома');
  await home.goto(`${BASE}/teacher/login`);
  await home.locator('a:has-text("Забыли пароль?")').click();
  await home.waitForURL(`${BASE}/teacher/forgot`);
  await home.waitForSelector('button:has-text("Прислать ссылку")');
  await home.fill('input[type=email]', 'demo@sinf.local');
  await home.locator('button:has-text("Прислать ссылку")').click();
  await home.waitForSelector('[data-sent]');
  check('«письмо отправлено»', true);
  await wait(300);
  const link = letterLink('demo@sinf.local');
  check('в письме — ссылка на новый пароль', !!link, link ? link.replace(/[^/]+$/, '…') : 'нет');

  await home.goto(link);
  await home.fill('input[data-field=new-password]', 'новый-пароль-1');
  await home.fill('input[data-field=new-password-again]', 'новый-пароль-1');
  await home.locator('button:has-text("Сохранить и войти")').click();
  await home.waitForURL(`${BASE}/teacher`);
  check('новый пароль сохранён, учитель вошёл', true);

  await school.reload();
  await school.waitForURL(/\/teacher\/login/);
  check('вход, оставленный в школе, закончился', true);

  await home.goto(link);
  await home.fill('input[data-field=new-password]', 'ещё-пароль-1');
  await home.fill('input[data-field=new-password-again]', 'ещё-пароль-1');
  await home.locator('button:has-text("Сохранить и войти")').click();
  await home.waitForSelector('a:has-text("Запросить новую ссылку")');
  check('ссылка одноразовая', true);

  // ---------- the administrator's link for a colleague
  const colleague = await (await browser.newContext()).newPage();
  watch(colleague, 'коллега');
  await colleague.goto(`${BASE}/teacher/register`);
  await colleague.fill('input[autocomplete=name]', 'Забывчивая Учительница');
  await colleague.fill('input[type=email]', 'forgot@example.com');
  await colleague.fill('input[type=password]', 'забыла-пароль-1');
  await colleague.click('button[type=submit]');
  await colleague.waitForURL(`${BASE}/teacher`);
  await colleague.evaluate(() => fetch('/api/schools/school-demo/requests', { method: 'POST' }));
  // She signs out: the home page is left first, so its own requests do not meet a missing login.
  await colleague.goto('about:blank');
  await colleague.context().clearCookies();

  await home.goto(`${BASE}/school/school-demo#teachers`);
  await home.locator('button:has-text("Принять")').click();
  await home.locator('[data-reset-for="Забывчивая Учительница"]').click();
  await home.waitForSelector('[data-reset-link] input');
  const given = await home.inputValue('[data-reset-link] input');
  check('администратор получил ссылку для учителя', /\/teacher\/reset\//.test(given));
  await home.screenshot({ path: `${S}/a7-admin-link.png` });

  await colleague.goto(given);
  await colleague.fill('input[data-field=new-password]', 'от-завуча-1');
  await colleague.fill('input[data-field=new-password-again]', 'от-завуча-1');
  await colleague.locator('button:has-text("Сохранить и войти")').click();
  await colleague.waitForURL(`${BASE}/teacher`);
  check('учитель задал пароль по ссылке завуча и вошёл', true);

  check(
    'ошибок в консоли нет',
    errors.filter((e) => !e.includes('400')).length === 0,
    errors.join(' | '),
  );
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
