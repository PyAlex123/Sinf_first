// W6 (STAGE4.md): a message to the class with a link, to everybody and to one child, and "open this
// screen for everybody" in free mode.
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
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  teacher.on('dialog', (d) => void d.accept());
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('text=Мои уроки');

  const { sessionId, kids } = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const details = await json('GET', '/api/classes/class-1a');
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'g10',
    });
    const kids = [];
    for (const last of ['Алиев', 'Каримова']) {
      const s = details.students.find((x) => x.lastName === last);
      const joined = await json('POST', '/api/join', {
        sessionId: session.id,
        studentId: s.id,
        code: s.code,
      });
      kids.push({ id: s.id, token: joined.token });
    }
    return { sessionId: session.id, kids };
  });
  await teacher.goto(`${BASE}/teacher/session/${sessionId}`);
  await teacher.waitForSelector('.msgbox');

  const pages = [];
  for (const k of kids) {
    const page = await (
      await browser.newContext({ viewport: { width: 1366, height: 768 } })
    ).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`ученик: ${m.text()}`));
    await page.goto(`${BASE}/`);
    await page.evaluate(
      ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
      [sessionId, k.token],
    );
    await page.goto(`${BASE}/s/${sessionId}`);
    await page.waitForSelector('button:has-text("Начать")', { timeout: 8000 });
    await page.locator('button:has-text("Начать")').first().click();
    pages.push(page);
  }
  const [aliev, karimova] = pages;

  // ---------- a message to everybody, with a link
  await teacher.fill('textarea[data-field=message]', 'Откройте сайт урока');
  await teacher.fill('input[data-field=message-url]', 'javascript:alert(1)');
  check(
    'ссылка не http(s) не отправляется',
    await teacher.locator('.msgbox button:has-text("Всем")').isDisabled(),
  );
  await teacher.fill('input[data-field=message-url]', 'https://example.org/lesson');
  await teacher.locator('.msgbox button:has-text("Всем")').click();
  for (const [i, page] of pages.entries()) {
    await page.waitForSelector('[data-message]', { timeout: 8000 });
    const link = await page.locator('[data-message] a').getAttribute('href');
    check(`сообщение со ссылкой у ученика ${i + 1}`, link === 'https://example.org/lesson');
    check(
      `ссылка открывается в новой вкладке без доступа к уроку (${i + 1})`,
      (await page.locator('[data-message] a').getAttribute('rel')) === 'noopener noreferrer',
    );
    await page.locator('[data-message] button:has-text("Закрыть")').click();
  }

  // ---------- to one child only
  await teacher.locator('button.pick:has-text("Каримова")').first().click();
  await teacher.fill('textarea[data-field=message]', 'Мадина, подойди ко мне');
  await teacher.locator('.msgbox button:has-text("Выбранным")').click();
  await karimova.waitForSelector('[data-message]', { timeout: 8000 });
  await aliev.waitForTimeout(800);
  check(
    'сообщение выбранной — только ей',
    (await aliev.locator('[data-message]').count()) === 0 &&
      (await karimova.locator('[data-message]').innerText()).includes('подойди'),
  );

  // ---------- free mode: open this screen for everybody
  await teacher.locator('button:has-text("Свободно")').click();
  // The lesson's first stage has a few screens: the teacher steps to the next one.
  await teacher.locator('button[aria-label="Дальше"]').first().click();
  await teacher.waitForTimeout(300);
  const teacherAt = Number((await teacher.locator('.pos').innerText()).match(/\d+/)?.[0]);
  await teacher.locator('button:has-text("Открыть этот экран у всех")').click();
  await aliev.waitForFunction(
    (n) => Number(document.querySelector('.count')?.textContent?.match(/\d+/)?.[0]) === n,
    teacherAt,
    { timeout: 8000 },
  );
  check('«Открыть этот экран у всех» — ученик на экране учителя', true, `экран ${teacherAt}`);

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
