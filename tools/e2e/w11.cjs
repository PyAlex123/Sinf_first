// W11 (STAGE4.md): the KTP and the lessons — suggestions linked at once, a lesson picked by hand,
// "where am I", the lesson's topic marked done right after it, changes against the school's share.
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
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Мои уроки');

  // A KTP as the wizard saves it: three topics past their dates, one to come.
  const planId = await page.evaluate(async () => {
    const day = (n) => {
      const d = new Date(Date.now() + n * 86_400_000);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    };
    const res = await fetch('/api/ktp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        classId: 'class-1a',
        title: 'Информатика',
        rows: [
          { number: '1', topic: 'Предыдущий и последующий', weekOrDate: day(-14) },
          { number: '2', topic: 'До и после', weekOrDate: day(-7) },
          { number: '3', topic: 'Было и стало', weekOrDate: day(-1) },
          { number: '4', topic: 'Повторение пройденного', weekOrDate: day(30) },
        ],
      }),
    });
    return (await res.json()).id;
  });

  await page.goto(`${BASE}/teacher/ktp/${planId}`);
  await page.waitForSelector('[data-where]');
  check(
    'где я по КТП: отставание 3 темы',
    (await page.locator('[data-delta]').innerText()) === 'отставание: 3 темы',
  );
  check('подсказки уроков по названию', (await page.locator('[data-suggest]').count()) === 3);
  await page.locator('button:has-text("Привязать все подсказки")').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-suggest]').length === 0);
  const linked = await page.locator('td.lesson a').allInnerTexts();
  check(
    'все подсказки привязаны одним нажатием',
    linked.join('|') === 'Предыдущий — последующий|До — после|Было — стало',
    linked.join('|'),
  );

  // The fourth topic: a lesson chosen by hand from the list.
  await page.locator('[data-choose="3"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#ktp-lessons option').length > 5);
  await page.fill('input[data-field=ktp-lesson]', 'Цикличность в природе');
  await page.locator('input[data-field=ktp-lesson]').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelectorAll('td.lesson a').length === 4);
  check('урок выбран вручную из списка', true);

  // The lesson of topic 1 is held; right after it, its topic is offered.
  const sessionId = await page.evaluate(async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'class-1a', lessonId: 'g10' }),
    });
    const { session } = await res.json();
    await fetch(`/api/sessions/${session.id}/end`, { method: 'POST' });
    return session.id;
  });
  await page.goto(`${BASE}/teacher/session/${sessionId}/results`);
  await page.waitForSelector('[data-ktp-box]');
  check(
    'после урока — его тема по КТП',
    /Предыдущий и последующий/.test(await page.locator('[data-ktp-box]').innerText()),
  );
  await page.locator('[data-ktp-box] button:has-text("Отметить проведённой")').click();
  await page.waitForSelector('[data-ktp-done]');
  check('тема отмечена проведённой одним нажатием', true);
  await page.screenshot({ path: `${S}/w11-results.png` });

  await page.goto(`${BASE}/teacher/ktp/${planId}`);
  await page.waitForSelector('[data-where]');
  check(
    'отставание стало меньше',
    (await page.locator('[data-delta]').innerText()) === 'отставание: 2 темы',
  );
  check('галочка «проведено» стоит', await page.locator('[data-done="0"]').isChecked());

  // A topic changed by hand counts; the school allows 30 %.
  await page.locator('[data-edit="2"]').click();
  await page.locator('form.edit input.grow').first().fill('Было — стало: повторяем');
  await page.locator('form.edit button[type=submit]').click();
  await page.waitForFunction(() =>
    /Изменено 1 из 4/.test(document.querySelector('[data-changes]')?.textContent ?? ''),
  );
  check('изменения считаются против файла', true);
  await page.fill('input[data-field=ktp-new-topic]', 'Контрольная работа');
  await page.locator('button:has-text("Добавить тему")').click();
  await page.waitForFunction(() =>
    /больше, чем разрешает школа/.test(document.querySelector('[data-changes]')?.textContent ?? ''),
  );
  check('больше 30 % — предупреждение', true);
  await page.screenshot({ path: `${S}/w11-plan.png`, fullPage: true });

  // The school's administrator allows more.
  await page.goto(`${BASE}/school/school-demo#rules`);
  // The school's rules (stage 5, A1) hold the KTP share now.
  await page.fill('input[data-field=ktp-percent]', '60');
  await page
    .locator('input[data-field=ktp-percent]')
    .locator('xpath=ancestor::form')
    .locator('button[type=submit]')
    .click();
  await page.waitForSelector('[data-saved]');
  await page.goto(`${BASE}/teacher/ktp/${planId}`);
  await page.waitForSelector('[data-changes]');
  const changes = await page.locator('[data-changes]').innerText();
  check(
    'процент из настроек школы',
    /допустимо 60 %/.test(changes) && !/больше/.test(changes),
    changes,
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
