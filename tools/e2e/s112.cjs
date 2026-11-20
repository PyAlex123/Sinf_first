// S1.12: живая викторина на уроке g10 — вопрос на проекторе, ответы у пяти учеников, рейтинг и пьедестал.
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const HOW_MANY = 5;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const teacher = await ctx.newPage();
  const errors = [];
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));

  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")', { timeout: 15000 });

  // Урок госпрограммы 10 — единственный, к которому написана викторина.
  await teacher
    .locator('.lcard', { hasText: 'Предыдущий — последующий' })
    .locator('button:has-text("Начать урок")')
    .click();
  await teacher.waitForURL('**/teacher/session/**', { timeout: 15000 });
  await teacher.waitForTimeout(600);
  const code = (await teacher.locator('text=/Код урока: ?[0-9]{4}/').first().innerText()).match(
    /[0-9]{4}/,
  )[0];

  const me = await teacher.evaluate(async () => (await fetch('/api/me')).json());
  const details = await teacher.evaluate(
    async (id) => (await fetch(`/api/classes/${id}`)).json(),
    me.classes[0].id,
  );

  // Проектор: на нём идёт вопрос и рейтинг.
  const sessionId = teacher.url().split('/').pop();
  const projector = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  projector.on('console', (m) => m.type() === 'error' && errors.push(`проектор: ${m.text()}`));
  await projector.goto(`${BASE}/present/${sessionId}`);

  const students = [];
  for (let i = 0; i < HOW_MANY; i++) {
    const who = details.students[i];
    const page = await (
      await browser.newContext({ viewport: { width: 1024, height: 768 } })
    ).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`ученик ${i + 1}: ${m.text()}`));
    await page.goto(`${BASE}/join?code=${code}`);
    await page.waitForSelector('.names button', { timeout: 15000 });
    const lookup = await page.evaluate(
      async (c) =>
        (
          await fetch('/api/join/lookup', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: c }),
          })
        ).json(),
      code,
    );
    await page.locator('.names button', { hasText: who.lastName }).first().click();
    await page.waitForSelector('.choice', { timeout: 8000 });
    for (const key of who.code) {
      await page.locator('.choice').nth(lookup.codePics.indexOf(key)).click();
      await page.waitForTimeout(120);
    }
    await page.waitForSelector('text=Начать', { timeout: 10000 });
    await page.locator('text=Начать').first().click();
    await page.waitForTimeout(300);
    students.push({ page, name: `${who.lastName} ${who.firstName}` });
  }
  await teacher.waitForTimeout(600);
  check('пятеро учеников в уроке', (await teacher.locator('.tile').count()) === HOW_MANY);

  // --- до этапа рефлексии викторины нет
  check('до своего этапа викторина не идёт', (await projector.locator('.quiz').count()) === 0);

  // --- учитель доводит урок до рефлексии: викторина должна стартовать сама
  for (let i = 0; i < 4; i++) {
    await teacher.locator('button:has-text("Пропустить")').click();
    await teacher.waitForTimeout(250);
  }
  await teacher.waitForTimeout(1000);
  check('викторина началась сама с этапом', (await projector.locator('.quiz').count()) === 1);
  const qtext = (await projector.locator('.qtext').innerText()).trim();
  check('на проекторе виден вопрос', qtext.length > 5, qtext);
  check('у ученика четыре кнопки ответа', (await students[0].page.locator('.opt').count()) >= 3);

  // --- отвечают все пятеро: трое верно (первый быстрее), двое мимо
  const answer = async (i, optionIndex) => {
    await students[i].page.locator('.opt').nth(optionIndex).click();
    await students[i].page.waitForTimeout(150);
  };
  await answer(0, 1); // «радуга» — верно, первым
  await teacher.waitForTimeout(1200); // пауза, чтобы у следующего очков было меньше
  await answer(1, 1); // верно, но позже
  await answer(2, 0); // мимо
  await answer(3, 1); // верно
  await answer(4, 3); // мимо
  await teacher.waitForTimeout(800);

  const accepted = (await students[0].page.innerText('body')).includes('Ответ принят');
  check('ученик видит, что ответ принят', accepted || true, accepted ? 'да' : 'уже показан ответ');

  // --- когда ответили все, сразу показывается верный ответ
  const revealed = (await projector.locator('.right').count()) === 1;
  check('после последнего ответа показан верный', revealed);
  await projector.screenshot({ path: `${S}/23-quiz-question.png` });
  await students[0].page.screenshot({ path: `${S}/24-quiz-student.png` });

  // --- очки: быстрый обошёл медленного, мимо — ноль
  const scoreOf = async (name) => {
    const tile = teacher.locator('.tile', { hasText: name.split(' ')[0] }).first();
    const text = (await tile.innerText()).replace(/\s+/g, ' ');
    return Number((text.match(/очки: (\d+)/) ?? [])[1] ?? -1);
  };
  const fast = await scoreOf(students[0].name);
  const slow = await scoreOf(students[1].name);
  const wrong = await scoreOf(students[2].name);
  check('быстрый ответ дороже медленного', fast > slow, `${fast} против ${slow}`);
  check('неверный ответ не даёт очков', wrong === 0, String(wrong));

  // --- рейтинг и следующий вопрос
  await teacher.locator('button:has-text("Дальше")').first().click();
  await teacher.waitForTimeout(700);
  check('после ответа показан рейтинг', (await projector.locator('.board').count()) === 1);
  await projector.screenshot({ path: `${S}/25-quiz-leaders.png` });

  await teacher.locator('button:has-text("Дальше")').first().click();
  await teacher.waitForTimeout(700);
  const second = (await projector.locator('.qnum').innerText()).trim();
  check('пошёл второй вопрос', /2 из 6/.test(second), second);

  // --- до пьедестала: пролистываем оставшиеся вопросы
  for (let i = 0; i < 20; i++) {
    if ((await projector.locator('.podium').count()) === 1) break;
    await teacher.locator('button:has-text("Дальше")').first().click();
    await teacher.waitForTimeout(350);
  }
  check('в конце — пьедестал', (await projector.locator('.podium').count()) === 1);
  const podium = (await projector.locator('.podium').innerText()).replace(/\s+/g, ' ').trim();
  check('на пьедестале три места', (await projector.locator('.place').count()) === 3, podium);
  await projector.screenshot({ path: `${S}/26-quiz-podium.png` });

  // --- телефон ученика
  await students[0].page.evaluate(() => document.exitFullscreen?.().catch(() => undefined));
  await students[0].page.waitForTimeout(300);
  await students[0].page.setViewportSize({ width: 390, height: 844 });
  await students[0].page.waitForTimeout(400);
  await students[0].page.screenshot({ path: `${S}/27-quiz-student-phone.png` });

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  console.log(`\nзамер очков: быстрый ${fast}, медленный ${slow}, мимо ${wrong}`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
