// A3 (STAGE5.md): the school's programs. The administrator allows Paint and Word only; in a lesson
// the teacher is offered just those, and a classroom computer (a fake app that has every program)
// shows only them, even when the teacher's old choice named Excel. The server must run with
// CLASSROOM_MODE=1.
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
          setTimeout(
            () =>
              emit({
                type: 'installed',
                apps: ['paint', 'notepad', 'word', 'excel', 'powerpoint'],
              }),
            20,
          );
      },
      addEventListener: (_t, l) => listeners.push(l),
      removeEventListener: () => undefined,
    };
  }, pcName);
  return page;
}
const tiles = (page) =>
  page.locator('button.paint').evaluateAll((bs) => bs.map((b) => b.dataset.app));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const teacher = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForURL(`${BASE}/teacher`);

  // The school's rules: Paint and Word only.
  await teacher.goto(`${BASE}/school/school-demo#rules`);
  for (const app of ['notepad', 'excel', 'powerpoint', 'scratch', 'arduino', 'python'])
    await teacher.locator(`input[data-app=${app}]`).uncheck();
  await teacher
    .locator('input[data-field=quota]')
    .locator('xpath=ancestor::form')
    .locator('button[type=submit]')
    .click();
  await teacher.waitForSelector('[data-saved]');

  const { sessionId, kid } = await teacher.evaluate(async () => {
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
    const s = details.students.find((x) => x.lastName === 'Алиев');
    const j = await json('POST', '/api/join', {
      sessionId: session.id,
      studentId: s.id,
      code: s.code,
      pc: 'ПК-05',
    });
    return { sessionId: session.id, kid: { id: s.id, token: j.token } };
  });
  const pc = await classroomPc(browser, 'ПК-05');
  pc.on('console', (m) => m.type() === 'error' && errors.push(`ученик: ${m.text()}`));
  await pc.goto(`${BASE}/join`);
  await pc.evaluate(
    ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
    [sessionId, kid.token],
  );
  await pc.goto(`${BASE}/s/${sessionId}`);
  await wait(800);

  await teacher.goto(`${BASE}/teacher/session/${sessionId}`);
  await teacher.waitForSelector('.appsbox');
  const offered = await teacher.locator('.appsbox label').allInnerTexts();
  check(
    'учителю предложены только Paint и Word',
    offered.map((s) => s.trim()).join(',') === 'Paint,Word',
    offered.join(','),
  );
  check(
    'и сказано, что так решила школа',
    /Школа разрешила только: Paint, Word/.test(
      await teacher.locator('[data-school-apps]').innerText(),
    ),
  );
  for (const app of ['Paint', 'Word'])
    await teacher.locator(`.appsbox label:has-text("${app}") input`).check();
  await teacher.locator('.appsbox button:has-text("Всем")').click();
  await pc.waitForSelector('button.paint[data-app="word"]');
  check(
    'у ребёнка — Paint и Word',
    JSON.stringify((await tiles(pc)).sort()) === '["paint","word"]',
  );

  // Even a direct command naming Excel gives nothing beyond the school's list.
  await teacher.evaluate((id) => {
    const ws = new WebSocket(
      `${location.origin.replace('http', 'ws')}/ws?session=${id}&role=teacher`,
    );
    return new Promise((done) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'teacher.apps.set',
            targets: 'all',
            apps: ['excel', 'word'],
          }),
        );
        setTimeout(() => {
          ws.close();
          done();
        }, 300);
      };
      ws.onerror = () => done();
    });
  }, sessionId);
  await wait(800);
  const after = await tiles(pc);
  check(
    'команда с Excel в обход страницы — Excel не появился',
    !after.includes('excel'),
    JSON.stringify(after),
  );
  await pc.screenshot({ path: `${S}/a3-tiles.png` });

  // A lesson whose practice is in Word, in a school that now allows Paint only.
  const second = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    await json('PATCH', '/api/schools/school-demo/settings', { apps: ['paint'] });
    const details = await json('GET', '/api/classes/class-1a');
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'proba-dokument',
    });
    const s = details.students.find((x) => x.lastName === 'Каримова');
    await json('POST', '/api/join', {
      sessionId: session.id,
      studentId: s.id,
      code: s.code,
      pc: 'ПК-06',
    });
    return session.id;
  });
  await teacher.goto(`${BASE}/teacher/session/${second}`);
  await teacher.waitForSelector('[data-practice-blocked]');
  check(
    'урок с практикой в Word, а школа разрешила только Paint — учителя предупреждают',
    /в Word, а школа эту программу не разрешила/.test(
      await teacher.locator('[data-practice-blocked]').innerText(),
    ),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
