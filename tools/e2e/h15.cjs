// H15 (STAGE3.md): program tiles. Classroom computers with a fake app (it has Paint, Notepad and
// Word, no Excel); the teacher gives programs to everybody and to one child; a new stage brings the
// lesson's own back; the app is asked to keep a working folder and shown the stage's time.
// The server must run with CLASSROOM_MODE=1.
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function classroomPc(browser, pcName) {
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  await page.addInitScript((name) => {
    window.sinfHost = { isDesktop: true, role: 'student', version: '0.1.0.0', pcName: name };
    window.__toHost = [];
    const listeners = [];
    const emit = (data) => listeners.forEach((l) => l({ data }));
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (m) => {
        window.__toHost.push(m);
        if (m.type === 'hello')
          setTimeout(() => emit({ type: 'installed', apps: ['paint', 'notepad', 'word'] }), 20);
        if (m.type === 'launch') setTimeout(() => emit({ type: 'app', running: true }), 20);
      },
      addEventListener: (_t, l) => listeners.push(l),
      removeEventListener: () => undefined,
    };
  }, pcName);
  return page;
}
const asked = (page, type) =>
  page.evaluate((t) => window.__toHost.filter((m) => m.type === t), type);
const tiles = (page) =>
  page.locator('button.paint').evaluateAll((bs) => bs.map((b) => b.dataset.app));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  teacher.on('dialog', (d) => void d.accept());
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")');
  const { sessionId, kids } = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const details = await json('GET', '/api/classes/class-1a');
    // g10: no Paint of its own on the practice — the teacher gives programs.
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'g10',
    });
    const kids = [];
    for (const [i, last] of ['Алиев', 'Каримова'].entries()) {
      const s = details.students.find((x) => x.lastName === last);
      const j = await json('POST', '/api/join', {
        sessionId: session.id,
        studentId: s.id,
        code: s.code,
        pc: `ПК-0${i + 5}`,
      });
      kids.push({ id: s.id, token: j.token });
    }
    return { sessionId: session.id, kids };
  });
  const pcs = [];
  for (const [i, kid] of kids.entries()) {
    const p = await classroomPc(browser, `ПК-0${i + 5}`);
    p.on('console', (m) => m.type() === 'error' && errors.push(`ученик ${i + 1}: ${m.text()}`));
    await p.goto(`${BASE}/join`);
    await p.evaluate(
      ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
      [sessionId, kid.token],
    );
    await p.goto(`${BASE}/s/${sessionId}`);
    pcs.push(p);
  }
  await wait(800);
  const folder = (await asked(pcs[0], 'folder')).at(-1);
  check(
    'приложение просят завести рабочую папку урока с токеном ученика',
    folder?.on === true && folder.token === kids[0].token,
  );
  check(
    'приложению сообщают время этапа',
    (await asked(pcs[0], 'timer')).some((m) => typeof m.inMs === 'number' && m.inMs > 0),
  );
  check('пока программ нет — плиток нет', (await tiles(pcs[0])).length === 0);

  await teacher.goto(`${BASE}/teacher/session/${sessionId}`);
  await teacher.waitForSelector('.appsbox');
  check(
    'у учителя «Программы у учеников» — как в уроке',
    (await teacher.locator('.appsbox').innerText()).includes('как в уроке'),
  );
  for (const app of ['Word', 'Excel', 'Блокнот'])
    await teacher.locator(`.appsbox label:has-text("${app}") input`).check();
  await teacher.locator('.appsbox button:has-text("Всем")').click();
  await pcs[0].waitForSelector('button.paint[data-app="word"]');
  check(
    'ученикам — Блокнот и Word; Excel на этих ПК нет — его плитки нет',
    JSON.stringify((await tiles(pcs[0])).sort()) === '["notepad","word"]',
    JSON.stringify(await tiles(pcs[0])),
  );
  await pcs[0].locator('button.paint[data-app="word"]').click();
  await wait(200);
  check(
    'плитка открывает программу по её имени в списке',
    (await asked(pcs[0], 'launch')).at(-1)?.app === 'word',
  );
  await pcs[0].screenshot({ path: `${S}/151-h15-tiles.png` });

  // One child only: Paint.
  await teacher.locator('.tile:has-text("ПК-06") .pick').click();
  for (const app of ['Word', 'Excel', 'Блокнот'])
    await teacher.locator(`.appsbox label:has-text("${app}") input`).uncheck();
  await teacher.locator('.appsbox label:has-text("Paint") input').check();
  await teacher.locator('.appsbox button:has-text("Выбранным")').click();
  await pcs[1].waitForSelector('button.paint[data-app="paint"]');
  check(
    'выбранному ученику — только Paint, остальным — как было',
    JSON.stringify(await tiles(pcs[1])) === '["paint"]' && (await tiles(pcs[0])).includes('word'),
  );

  // Word taken from everybody while it is open: the app is asked to close what is no longer allowed.
  await teacher.locator('.appsbox button:has-text("Как в уроке")').click();
  await wait(500);
  const close = (await asked(pcs[0], 'closeApps')).at(-1);
  check(
    'убрали Word, пока он открыт — приложение просят закрыть лишнее',
    Array.isArray(close?.keep) && !close.keep.includes('word'),
    JSON.stringify(close),
  );
  check(
    '«Как в уроке» — плитки ушли',
    (await tiles(pcs[0])).length === 0 && (await tiles(pcs[1])).length === 0,
  );

  // A new stage brings the lesson's own back.
  await teacher.locator('.appsbox label:has-text("Блокнот") input').check();
  await teacher.locator('.appsbox button:has-text("Всем")').click();
  await pcs[0].waitForSelector('button.paint[data-app="notepad"]');
  await teacher.locator('button:has-text("Пропустить")').click();
  await wait(600);
  check('следующий этап — снова программы урока', (await tiles(pcs[0])).length === 0);

  await teacher.locator('button:has-text("Завершить урок")').click();
  await wait(800);
  check(
    'конец урока — рабочую папку закрывают',
    (await asked(pcs[0], 'folder')).at(-1)?.on === false,
  );
  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
