// W4 (STAGE4.md): a teacher's test — the question editor, a child answering in a browser lesson, the
// teacher's tile and the results.
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

  // A lesson whose first stage is a test at the children's computers.
  const lessonId = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      }).then((r) => r.json());
    const made = await json('POST', '/api/authored-lessons', {
      title: 'Устройства компьютера',
      grade: 5,
      template: 'empty',
    });
    const doc = {
      stages: [
        {
          key: 'theory',
          title: 'Тест',
          minutes: 20,
          place: 'computer',
          blocks: [
            {
              id: 'q1',
              kind: 'question',
              text: 'Чем вводят текст?',
              mode: 'single',
              options: [
                { text: 'мышью' },
                { text: 'клавиатурой', correct: true },
                { text: 'монитором' },
              ],
            },
            {
              id: 'q2',
              kind: 'question',
              text: 'Что из этого — устройства вывода?',
              mode: 'multi',
              options: [
                { text: 'монитор', correct: true },
                { text: 'клавиатура' },
                { text: 'принтер', correct: true },
              ],
            },
          ],
        },
        { key: 'summary', title: 'Итоги', minutes: 5, place: 'projector', blocks: [] },
      ],
    };
    await json('PUT', `/api/authored-lessons/${made.id}`, {
      title: made.title,
      grade: 5,
      topic: '',
      visibility: 'private',
      doc,
      version: 1,
    });
    return made.id;
  });

  // ---------- the question editor: a typed answer
  await teacher.goto(`${BASE}/teacher/lessons/${lessonId}/edit`);
  await teacher.waitForSelector('ol.blocks li');
  await teacher.locator('button:has-text("+ Вопрос")').click();
  await teacher.waitForSelector('[data-problem=text]');
  check('новый вопрос просит текст', true);
  await teacher.fill('textarea[data-field=question-text]', 'Какая клавиша переносит строку?');
  await teacher.selectOption('select[data-field=question-mode]', 'input');
  await teacher.waitForSelector('[data-problem=answers]');
  await teacher.fill('textarea[data-field=question-answers]', 'Enter\nЭнтер');
  await teacher.waitForSelector('[data-problem]', { state: 'detached' });
  check('вопрос с вводом готов, когда есть ответ', true);
  await teacher.waitForSelector('.status[data-status=saved]', { timeout: 10000 });

  // ---------- the lesson with a child in a browser
  const { sessionId, token } = await teacher.evaluate(async (id) => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const details = await json('GET', '/api/classes/class-1a');
    const s = details.students.find((x) => x.lastName === 'Алиев');
    const { session } = await json('POST', '/api/sessions', { classId: 'class-1a', lessonId: id });
    const joined = await json('POST', '/api/join', {
      sessionId: session.id,
      studentId: s.id,
      code: s.code,
    });
    return { sessionId: session.id, token: joined.token };
  }, lessonId);
  await teacher.goto(`${BASE}/teacher/session/${sessionId}`);
  await teacher.waitForSelector('[data-test]', { timeout: 8000 });

  const kid = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  kid.on('console', (m) => m.type() === 'error' && errors.push(`ученик: ${m.text()}`));
  await kid.goto(`${BASE}/`);
  await kid.evaluate(
    ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
    [sessionId, token],
  );
  await kid.goto(`${BASE}/s/${sessionId}`);
  await kid.waitForSelector('button:has-text("Начать")', { timeout: 8000 });
  await kid.locator('button:has-text("Начать")').first().click();
  await kid.waitForSelector('.question');
  check(
    'у ученика вопрос 1 из 3',
    (await kid.locator('.question .num').innerText()).includes('1 из 3'),
  );

  await kid.locator('.question .opt:has-text("клавиатурой")').click();
  await kid.locator('.question button.go').click();
  await kid.waitForSelector('.said.ok');
  check('верный ответ — «Верно!»', true);
  await teacher.waitForSelector('[data-test="1/3"]', { timeout: 8000 });
  check('на плитке учителя «Тест: 1 из 3»', true);

  await kid.keyboard.press('ArrowRight');
  await kid.waitForSelector('.question[data-mode=multi]');
  await kid.locator('.question .opt:has-text("монитор")').click();
  await kid.locator('.question button.go').click();
  await kid.waitForSelector('.said.no');
  check('неполный ответ на «несколько» — неверно, ответ принят', true);
  check(
    'после ответа выбрать другое нельзя',
    await kid.locator('.question .opt').first().isDisabled(),
  );

  await kid.keyboard.press('ArrowRight');
  await kid.waitForSelector('.question[data-mode=input]');
  await kid.fill('.question input.typed', '  энтер ');
  await kid.locator('.question button.go').click();
  await kid.waitForSelector('.said.ok');
  check('введённый ответ без учёта регистра и пробелов — верно', true);
  await teacher.waitForSelector('[data-test="3/3"]', { timeout: 8000 });
  await kid.screenshot({ path: `${S}/w4-question.png` });

  // After a reload the answered question stays answered.
  await kid.reload();
  await kid.waitForSelector('button:has-text("Начать")');
  await kid.locator('button:has-text("Начать")').first().click();
  await kid.waitForSelector('.question');
  check(
    'после перезагрузки ответ не дать второй раз',
    (await kid.locator('.said:has-text("уже принят")').count()) === 1,
  );

  await teacher.locator('button:has-text("Завершить урок")').click();
  await teacher.waitForTimeout(500);
  await teacher.goto(`${BASE}/teacher/session/${sessionId}/results`);
  await teacher.waitForSelector('th:has-text("Тест")');
  const cell = await teacher.locator('tr:has-text("Алиев") td').nth(3).innerText();
  check('в итогах столбец «Тест»: 2 из 3', cell.includes('2 из 3'), cell);

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
