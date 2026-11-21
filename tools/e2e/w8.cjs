// W8 (STAGE4.md): the library — one teacher publishes a lesson, another finds it, copies it,
// reports another one.
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
  const author = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  author.on('console', (m) => m.type() === 'error' && errors.push(`автор: ${m.text()}`));
  await author.goto(`${BASE}/teacher/login`);
  await author.fill('input[type=email]', 'demo@sinf.local');
  await author.fill('input[type=password]', 'demo1234');
  await author.click('button[type=submit]');
  await author.waitForSelector('text=Мои уроки');
  const lessonId = await author.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      }).then((r) => r.json());
    const made = await json('POST', '/api/authored-lessons', {
      title: 'Ёлочка из фигур',
      grade: 2,
    });
    await json('PUT', `/api/authored-lessons/${made.id}`, {
      title: made.title,
      grade: 2,
      topic: 'Рисуем в Paint',
      visibility: 'public',
      doc: made.doc,
      version: 1,
    });
    return made.id;
  });

  // ---------- another teacher
  const reader = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  reader.on('console', (m) => m.type() === 'error' && errors.push(`читатель: ${m.text()}`));
  reader.on('dialog', (d) => void d.accept('Не подходит для начальной школы'));
  await reader.goto(`${BASE}/teacher/register`);
  await reader
    .fill('input[autocomplete=name], input[name=fullName]', 'Учитель Читатель')
    .catch(() => undefined);
  const inputs = reader.locator('form input');
  if ((await inputs.count()) >= 3) {
    await inputs.nth(0).fill('Учитель Читатель');
    await inputs.nth(1).fill(`reader${Date.now()}@example.com`);
    await inputs.nth(2).fill('reader-pass-123');
  }
  await reader.locator('form button[type=submit]').click();
  await reader.waitForSelector('text=Мои уроки', { timeout: 10000 });
  await reader.goto(`${BASE}/teacher/library`);
  await reader.waitForSelector(`[data-item="${lessonId}"]`);
  check('опубликованный урок в библиотеке', true);
  await reader.fill('input[data-field=q]', 'ЕЛОЧКА');
  await reader.waitForTimeout(600);
  check(
    'поиск без учёта регистра и «ё»',
    (await reader.locator(`[data-item="${lessonId}"]`).count()) === 1,
  );
  await reader.selectOption('select[data-field=grade]', '7');
  await reader.waitForSelector(`[data-item="${lessonId}"]`, { state: 'detached' });
  check('фильтр по классу', true);
  await reader.selectOption('select[data-field=grade]', '2');
  await reader.waitForSelector(`[data-item="${lessonId}"]`);

  await reader.locator(`[data-item="${lessonId}"] button:has-text("Пожаловаться")`).click();
  await reader.waitForSelector('text=Жалоба отправлена');
  check('жалоба отправлена', true);

  await reader.locator(`[data-item="${lessonId}"] button:has-text("Копировать себе")`).click();
  await reader.waitForURL(/\/teacher\/lessons\/u-[0-9a-f]{32}\/edit$/);
  const copyId = reader.url().split('/').at(-2);
  check('копия открылась в конструкторе как своя', copyId !== lessonId);
  await reader.goto(`${BASE}/teacher`);
  await reader.waitForSelector(`li[data-lesson="${copyId}"]`);
  check('копия в «Мои уроки»', true);

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
