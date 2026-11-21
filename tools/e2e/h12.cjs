// H12 (STAGE3.md): "Мои работы". A child in a browser lesson saves a file into their folder; the
// teacher sees it in the child's folder and collects the class's works as a ZIP; a child of a
// digit-code class opens their folder from home with the class code from the card.
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
  const teacherCtx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
  });
  const teacher = await teacherCtx.newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  teacher.on('dialog', (d) => void d.accept());
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")');

  // ---------- a browser lesson: the child saves a drawing into their folder
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
  const kidCtx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
  });
  const kid = await kidCtx.newPage();
  kid.on('console', (m) => m.type() === 'error' && errors.push(`ученик: ${m.text()}`));
  kid.on('dialog', (d) => void d.accept());
  await kid.goto(`${BASE}/`);
  await kid.evaluate(
    ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
    [sessionId, token],
  );
  await kid.goto(`${BASE}/s/${sessionId}`);
  // In a browser the lesson opens with a big "Начать" (full screen); wait for it to be there.
  await kid.waitForSelector('button:has-text("Начать")', { timeout: 8000 });
  await kid.locator('button:has-text("Начать")').first().click();
  await kid.locator('button.filesbtn').click();
  await kid.waitForSelector('.filesover');
  check('в уроке в браузере есть «Мои работы»', (await kid.locator('.filesover').count()) === 1);
  // Files are handed over as data: headless Chromium drops paths with Cyrillic letters.
  const drawing = {
    name: 'Рисунок.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  };
  const virus = {
    name: 'game.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('MZ'),
  };
  await kid.locator('.filesover input[type=file]').setInputFiles([drawing, virus]);
  await kid.waitForSelector('.filesover li:has-text("Рисунок.png")');
  check('файл сохранён и виден в списке', true);
  check(
    '.exe не принят, с понятной причиной',
    (await kid.locator('.filesover .notice').innerText()).includes('такие файлы хранить нельзя'),
  );
  const [dl] = await Promise.all([
    kid.waitForEvent('download'),
    kid.locator('.filesover li:has-text("Рисунок.png") button:has-text("Скачать")').click(),
  ]);
  // Headless Chromium saves a Cyrillic name as "download"; what matters is that the bytes came.
  const got = require('node:fs').readFileSync(await dl.path());
  check('файл скачивается целиком', got.equals(drawing.buffer), dl.suggestedFilename());
  await kid.screenshot({ path: `${S}/121-h12-lesson.png` });

  // ---------- the teacher: the child's folder and the class's ZIP
  await teacher.goto(`${BASE}/teacher/class/class-1a`);
  await teacher.waitForSelector('a:has-text("Собрать работы")');
  await teacher.locator('tr:has-text("Алиев") a:has-text("Мои работы")').click();
  await teacher.waitForSelector('li:has-text("Рисунок.png")');
  check(
    'учитель видит папку ученика, без кнопок загрузки и удаления',
    (await teacher.locator('button:has-text("Загрузить файл")').count()) === 0 &&
      (await teacher.locator('button:has-text("Удалить")').count()) === 0,
  );
  const zip = await teacher.evaluate(async () => {
    const r = await fetch('/api/classes/class-1a/works.zip');
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, magic: [b[0], b[1]], size: b.length };
  });
  check(
    '«Собрать работы» отдаёт ZIP',
    zip.status === 200 && zip.magic[0] === 0x50 && zip.magic[1] === 0x4b,
    JSON.stringify(zip),
  );

  // ---------- home: a grade-5 class with digit codes
  const home = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const me = await json('GET', '/api/me');
    let cls = me.classes.find((c) => c.name === '5Д');
    if (!cls) cls = (await json('POST', '/api/classes', { name: '5Д', grade: 5 })).class;
    await json('POST', `/api/classes/${cls.id}/students`, {
      students: [{ lastName: 'Юсупов', firstName: 'Сардор' }],
    });
    const details = await json('GET', `/api/classes/${cls.id}`);
    return { classId: cls.id, homeCode: details.class.homeCode, code: details.students[0].code };
  });
  await teacher.goto(`${BASE}/teacher/class/${home.classId}/cards`);
  await teacher.waitForSelector('.card');
  check(
    'на карточке — код класса для дома',
    (await teacher.locator('.card .homecode').first().innerText()).includes(home.homeCode),
    home.homeCode,
  );
  await teacher.screenshot({ path: `${S}/122-h12-card.png` });

  const homeCtx = await browser.newContext({
    viewport: { width: 414, height: 860 },
    acceptDownloads: true,
  });
  const phone = await homeCtx.newPage();
  phone.on(
    'console',
    // 401, 403 and 404 are the answers this test asks for: not logged in, picture class, wrong code.
    (m) =>
      m.type() === 'error' &&
      !/status of (401|403|404)/.test(m.text()) &&
      errors.push(`дома: ${m.text()}`),
  );
  await phone.goto(`${BASE}/`);
  await phone.locator('a:has-text("Мои работы")').click();
  await phone.waitForSelector('input[aria-label="Код класса"]');
  await phone.fill('input[aria-label="Код класса"]', '000000');
  await phone.locator('button[type=submit]').click();
  await phone.waitForSelector('.notice');
  check(
    'неверный код класса — понятная ошибка',
    (await phone.locator('.notice').innerText()).includes('Такого кода класса нет'),
  );
  await phone.fill('input[aria-label="Код класса"]', home.homeCode);
  await phone.locator('button[type=submit]').click();
  await phone.locator('.names button', { hasText: 'Юсупов' }).click();
  for (const d of home.code)
    await phone.locator('.digit', { hasText: new RegExp(`^${d}$`) }).click();
  await phone.waitForSelector('text=Юсупов Сардор · 5Д');
  check('дома: код класса → имя → свой код → своя папка', true);
  await phone.locator('input[type=file]').setInputFiles(drawing);
  await phone.waitForSelector('li:has-text("Рисунок.png")');
  check('дома файл загружается', true);
  await phone.screenshot({ path: `${S}/123-h12-home.png`, fullPage: true });
  await phone.reload();
  await phone.waitForSelector('li:has-text("Рисунок.png")');
  check('после перезагрузки вход сохранился', true);
  await phone.locator('button:has-text("Выйти")').click();
  await phone.waitForSelector('input[aria-label="Код класса"]');
  check('«Выйти» — снова код класса', true);

  // A picture-code class (1А) stays at school.
  const pictureClass = await teacher.evaluate(
    async () => (await (await fetch('/api/classes/class-1a')).json()).class.homeCode,
  );
  await phone.fill('input[aria-label="Код класса"]', pictureClass);
  await phone.locator('button[type=submit]').click();
  await phone.waitForSelector('.notice');
  check(
    'класс с картинками из дома не пускает',
    (await phone.locator('.notice').innerText()).includes('только в школе'),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
