// H10 (STAGE3.md): the teacher confirms grades in the lesson's results. The calculated grade is only
// offered (dashed) until the teacher takes it — all at once or one child — or picks another; the
// journal shows which grades are still suggestions. Fresh demo data; any server mode.
// (Screenshots going to the cloud are covered by apps/server/test/sync-worker.test.ts: it needs two
// servers and a paired device.)
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
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
  teacher.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")');

  // A short lesson held through the API: two children came, the class turns stars into grades.
  const sessionId = await teacher.evaluate(async () => {
    const json = (method, url, body) =>
      fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      }).then((r) => r.json());
    await json('PATCH', '/api/classes/class-1a/settings', { starsToGrade: true });
    const details = await json('GET', '/api/classes/class-1a');
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'g10',
    });
    for (const last of ['Алиев', 'Каримова']) {
      const s = details.students.find((x) => x.lastName === last);
      await json('POST', '/api/join', { sessionId: session.id, studentId: s.id, code: s.code });
    }
    await json('POST', `/api/sessions/${session.id}/end`);
    return session.id;
  });

  await teacher.goto(`${BASE}/teacher/session/${sessionId}/results`);
  await teacher.waitForSelector('.confirm');
  const row = (name) => teacher.locator('tbody tr', { hasText: name });
  check(
    'оценки предложены (пунктир), но не подтверждены',
    (await teacher.locator('.confirm').innerText()).includes('2') &&
      (await row('Алиев').locator('.pg.offered').count()) === 1 &&
      (await row('Алиев').locator('.pg.on').count()) === 0,
  );
  check('отсутствующему оценку не ставят', (await row('Иванов').locator('.pg').count()) === 0);
  await teacher.screenshot({ path: `${S}/101-h10-offered.png` });

  await teacher.locator('button:has-text("Подтвердить все предложенные")').click();
  await teacher.waitForSelector('.confirm', { state: 'detached' });
  check(
    '«Подтвердить все» — оценки стоят у обоих',
    (await row('Алиев').locator('.pg.on').count()) === 1 &&
      (await row('Каримова').locator('.pg.on').count()) === 1,
  );

  await row('Алиев').locator('.pg', { hasText: '5' }).click();
  await teacher.waitForFunction(
    () =>
      [...document.querySelectorAll('tbody tr')]
        .find((tr) => tr.textContent.includes('Алиев'))
        ?.querySelector('.pg.on')?.textContent === '5',
  );
  check('учитель ставит свою оценку одним кликом', true);
  await teacher.reload();
  await teacher.waitForSelector('.pg.on');
  check(
    'после перезагрузки оценка на месте',
    (await row('Алиев').locator('.pg.on').innerText()) === '5',
  );
  await teacher.screenshot({ path: `${S}/102-h10-confirmed.png` });

  // Clicking the confirmed grade again takes it back to the suggestion.
  await row('Каримова').locator('.pg.on').click();
  await teacher.waitForSelector('.confirm');
  check(
    'повторный клик возвращает к предложенной',
    (await row('Каримова').locator('.pg.offered').count()) === 1,
  );

  await teacher.goto(`${BASE}/teacher/journal/class-1a`);
  await teacher.waitForSelector('.cell.grade');
  const cells = await teacher.locator('tbody tr').evaluateAll((trs) =>
    Object.fromEntries(
      trs.map((tr) => [
        tr.querySelector('th, td.name, td:nth-child(2)')?.textContent?.trim() ?? '',
        [...tr.querySelectorAll('.cell.grade')].map((c) => ({
          text: c.textContent.trim(),
          offered: c.classList.contains('offered'),
        })),
      ]),
    ),
  );
  const find = (name) =>
    Object.entries(cells)
      .find(([k]) => k.includes(name))?.[1]
      ?.at(-1);
  check(
    'журнал: подтверждённая «5» — обычным шрифтом, предложенная — курсивом',
    find('Алиев')?.text === '5' && find('Алиев')?.offered === false && find('Каримова')?.offered,
    JSON.stringify({ a: find('Алиев'), k: find('Каримова') }),
  );
  await teacher.screenshot({ path: `${S}/103-h10-journal.png` });

  await teacher.evaluate(() =>
    fetch('/api/classes/class-1a/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starsToGrade: false }),
    }),
  );
  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
