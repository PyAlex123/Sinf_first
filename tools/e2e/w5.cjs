// W5 (STAGE4.md): the practice task and the live quiz assembled in the constructor, then a lesson
// with them: the child gets the template, hands in the finished file, and answers the quiz.
const { chromium } = require('playwright');
const { mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
mkdirSync(S, { recursive: true });
const ROOT = join(__dirname, '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'content/proba-praktiki/templates/oformi-dokument.docx'));
const DONE = readFileSync(
  join(ROOT, 'apps/server/test/fixtures/practice/oformi-dokument-done.docx'),
);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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
  const lessonId = await teacher.evaluate(async () => {
    const r = await fetch('/api/authored-lessons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Документ в Word', grade: 6 }),
    });
    return (await r.json()).id;
  });

  // ---------- the practice task in the constructor
  await teacher.goto(`${BASE}/teacher/lessons/${lessonId}/edit`);
  await teacher.locator('.seg[data-stage=practice]').click();
  await teacher.locator('button:has-text("+ Задание практики")').click();
  await teacher.waitForSelector('.practice-editor');
  await teacher.locator('.practice-editor button:has-text("Добавить проверку")').click();
  await teacher.locator('.practice-editor button:has-text("Добавить ручной критерий")').click();
  await teacher.locator('.practice-editor .crit input.label').last().fill('Аккуратно');
  await teacher.waitForSelector('input[data-field=template]', { state: 'attached' });
  await teacher
    .locator('input[data-field=template]')
    .setInputFiles({ name: 'template.docx', mimeType: DOCX, buffer: TEMPLATE });
  await teacher.waitForSelector('text=Шаблон загружен');
  check('задание практики собрано, шаблон загружен', true);

  // ---------- the live quiz
  await teacher.locator('.seg[data-stage=reflection]').click();
  await teacher.locator('button:has-text("Живая викторина")').click();
  await teacher.locator('button:has-text("+ Вопрос викторины")').click();
  await teacher.fill(
    '[data-quiz="0"] input[data-field=quiz-text]',
    'Где выбирают стиль заголовка?',
  );
  await teacher.fill('[data-quiz="0"] input[data-quiz-option="0"]', 'На вкладке «Главная»');
  await teacher.fill('[data-quiz="0"] input[data-quiz-option="1"]', 'На вкладке «Вид»');
  await teacher.locator('button:has-text("+ Вопрос викторины")').click();
  await teacher.waitForSelector('[data-quiz="1"] .warn');
  check('недописанный вопрос викторины помечен', true);
  await teacher.waitForSelector('.status[data-status=saved]', { timeout: 10000 });

  const saved = await teacher.evaluate(async (id) => {
    const l = await fetch(`/api/authored-lessons/${id}`).then((r) => r.json());
    const q = await fetch(`/api/lessons/${id}/quiz`).then((r) => r.json());
    return {
      practice: l.doc.practice,
      asked: q.quiz?.questions.length ?? 0,
      kept: l.doc.quiz?.questions.length,
    };
  }, lessonId);
  check(
    'в уроке: задание (1 авто + 1 ручной, шаблон), викторина (задаётся 1 из 2)',
    saved.practice?.criteria.length === 2 &&
      !!saved.practice?.template &&
      saved.asked === 1 &&
      saved.kept === 2,
    JSON.stringify({
      criteria: saved.practice?.criteria.length,
      asked: saved.asked,
      kept: saved.kept,
    }),
  );
  await teacher.screenshot({ path: `${S}/w5-quiz-editor.png` });

  // ---------- the lesson
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
  await teacher.waitForSelector('button:has-text("Пропустить")');
  const kid = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true })
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

  await teacher.locator('button:has-text("Пропустить")').click();
  await kid.waitForSelector('section.practice', { timeout: 8000 });
  const [dl] = await Promise.all([
    kid.waitForEvent('download'),
    kid.locator('section.practice button:has-text("Скачать задание")').click(),
  ]);
  check('у ученика шаблон из конструктора', readFileSync(await dl.path()).equals(TEMPLATE));
  await kid
    .locator('section.practice input[type=file]')
    .setInputFiles({ name: 'Документ.docx', mimeType: DOCX, buffer: DONE });
  await kid.waitForSelector('section.practice [data-score]:has-text("1 из 1")', { timeout: 8000 });
  await teacher.waitForSelector('[data-check="1/1"]', { timeout: 8000 });
  check('сданный файл проверен: «1 из 1» у ученика и учителя', true);

  // ---------- the quiz in the reflection
  await teacher.locator('button:has-text("Пропустить")').click();
  // The quiz starts by itself with its stage (S1.12); the button is only a fallback.
  await teacher
    .locator('button:has-text("Начать викторину")')
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await kid.waitForSelector('.quiz .qtext', { timeout: 30000 });
  check(
    'викторина учителя у ученика: вопрос и ответы словами',
    (await kid.locator('.quiz .qtext').innerText()).includes('стиль заголовка') &&
      (await kid.locator('.quiz .opt').count()) === 2 &&
      (await kid.locator('.quiz .opt b.long').count()) === 1,
  );
  await kid.screenshot({ path: `${S}/w5-quiz.png` });

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
