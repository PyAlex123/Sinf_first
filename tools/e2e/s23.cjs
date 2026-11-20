const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (n, ok, extra = '') =>
  out.push(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`);

async function login(ctx, email, password) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/teacher/login`);
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', password);
  await p.click('button[type=submit]');
  await p.waitForURL('**/teacher');
  await p.waitForSelector('h1');
  return p;
}

async function register(ctx, name, email) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/teacher/register`);
  await p.fill('input[autocomplete=name]', name);
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', 'parol12345');
  await p.click('button[type=submit]');
  await p.waitForURL('**/teacher');
  await p.waitForSelector('h1');
  return p;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const stamp = Date.now();
  const adminEmail = `dir${stamp}@example.com`;
  const teacherEmail = `uch${stamp}@example.com`;
  // Имя уникально: иначе повторный прогон натыкается на школы прошлых запусков.
  const SCHOOL = `Школа № ${stamp}`;

  // 1. суперадмин заводит школу
  const root = await login(
    await browser.newContext({ viewport: { width: 1366, height: 900 } }),
    'root@sinf.local',
    'superparol123',
  );
  root.on('response', (r) => {
    if (r.status() >= 400) errors.push(`админ: ${r.status()} ${r.url()}`);
  });
  await root.click('a:has-text("Школы платформы")');
  await root.waitForURL('**/admin');
  await root.waitForSelector('h1:has-text("Школы платформы")');
  await root.fill('input[maxlength="120"]', SCHOOL);
  await root.fill('input[maxlength="60"]', 'Ташкент');
  await root.click('button:has-text("Создать школу")');
  await root.waitForSelector(`tr:has-text("${SCHOOL}")`, { timeout: 10000 });
  check('суперадмин создал школу', true);

  // 2. будущий директор регистрируется, суперадмин назначает его администратором
  const director = await register(await browser.newContext(), 'Директор Школы', adminEmail);
  const row = root.locator('tr', { hasText: SCHOOL });
  await row.locator('input[type=email]').fill(adminEmail);
  await row.locator('button:has-text("Назначить")').click();
  await root.waitForTimeout(800);
  check(
    'администратор назначен',
    (await root.locator(`tr:has-text("${SCHOOL}")`).innerText()).includes('Директор'),
  );

  // 3. директор видит кабинет школы
  await director.goto(`${BASE}/teacher`);
  await director.waitForSelector('h1');
  await director.click('a[href^="/school/"]');
  await director.waitForURL('**/school/**');
  await director.waitForSelector(`h1:has-text("${SCHOOL}")`);
  check('директор открыл кабинет школы', true);

  // 4. второй учитель подаёт заявку
  const teacher = await register(await browser.newContext(), 'Учитель Информатики', teacherEmail);
  // Ловим адреса неудачных ответов: текст в консоли адреса не содержит.
  teacher.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/api/admin/schools')) {
      errors.push(`учитель: ${r.status()} ${r.url()}`);
    }
  });
  await teacher.click('a:has-text("Найти свою школу")');
  await teacher.waitForURL('**/teacher/schools');
  await teacher.waitForSelector(`li:has-text("${SCHOOL}")`);
  await teacher
    .locator('li', { hasText: SCHOOL })
    .locator('button:has-text("Подать заявку")')
    .click();
  await teacher.waitForSelector('text=/Заявка в .*отправлена/', { timeout: 8000 });
  check('учитель подал заявку', true);

  // пока не подтверждено — классов школы не видно
  const beforeApprove = await teacher.evaluate(
    async () => (await (await fetch('/api/me')).json()).classes.length,
  );
  check(
    'до подтверждения классов школы не видно',
    beforeApprove === 0,
    `классов: ${beforeApprove}`,
  );

  // 5. директор подтверждает
  await director.reload();
  await director.waitForSelector('h2:has-text("Заявки")', { timeout: 10000 });
  await director
    .locator('tr', { hasText: 'Учитель Информатики' })
    .locator('button:has-text("Принять")')
    .click();
  await director.waitForTimeout(900);
  check('заявка принята', (await director.locator('h2:has-text("Заявки")').count()) === 0);
  await director.screenshot({ path: `${S}/s23-school.png` });

  // 6. теперь учитель видит школу; классов в ней ещё нет — заведём класс директором и проверим
  await director.goto(`${BASE}/teacher`);
  await director.waitForSelector('h1');
  await director.click('button:has-text("Создать класс")');
  await director.waitForSelector('input[maxlength="20"]');
  await director.fill('input[maxlength="20"]', '6А');
  await director.selectOption('select', '6');
  await director.click('button:has-text("Создать")');
  await director.waitForURL('**/teacher/class/**');
  await director.waitForSelector('h1:has-text("6А")');

  await teacher.goto(`${BASE}/teacher`);
  await teacher.waitForSelector('h1', { timeout: 10000 });
  const afterApprove = await teacher.evaluate(async () =>
    (await (await fetch('/api/me')).json()).classes.map((c) => c.name),
  );
  check(
    'учитель школы видит класс школы',
    afterApprove.includes('6А'),
    `классы: ${afterApprove.join(', ')}`,
  );

  // 7. исключение закрывает доступ
  const teacherId = await teacher.evaluate(
    async () => (await (await fetch('/api/me')).json()).teacher.id,
  );
  await director.goto(director.url().replace(/\/teacher\/class\/.*/, '/teacher'));
  await director.waitForSelector('h1');
  await director.click('a[href^="/school/"]');
  await director.waitForSelector('h2:has-text("Учителя")');
  await director
    .locator('tr', { hasText: 'Учитель Информатики' })
    .locator('button:has-text("Исключить")')
    .click();
  await director.waitForTimeout(900);
  const afterRemove = await teacher.evaluate(
    async () => (await (await fetch('/api/me')).json()).classes.length,
  );
  check('после исключения классы школы пропали', afterRemove === 0, `классов: ${afterRemove}`);

  // 8. обычный учитель не видит раздел суперадмина
  const admArea = await teacher.evaluate(async () => (await fetch('/api/admin/schools')).status);
  check('раздел платформы учителю недоступен', admArea === 404, `код ${admArea}`);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
  process.exit(out.some((l) => l.startsWith('❌')) ? 1 : 0);
})();
