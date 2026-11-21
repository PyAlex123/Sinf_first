// W13 (STAGE4.md): grades kept in Excel into the journal — the header and the columns guessed, the
// children matched by name, two doubtful rows decided by the teacher, three journal columns made.
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
const FILE = join(
  __dirname,
  '..',
  '..',
  'apps',
  'server',
  'test',
  'fixtures',
  'grades',
  'grades.xlsx',
);
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
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Мои уроки');

  await page.goto(`${BASE}/teacher/journal/class-1a`);
  await page.locator('a:has-text("Загрузить оценки")').click();
  await page.waitForURL('**/journal/class-1a/import');
  await page.setInputFiles('input[data-field=grades-file]', FILE);
  await page.waitForSelector('[data-undecided]');

  const header = await page.$eval(
    'select[data-field=grades-header]',
    (s) => s.selectedOptions[0]?.textContent ?? '',
  );
  const names = await page.$eval(
    'select[data-field=grades-name]',
    (s) => s.selectedOptions[0]?.textContent ?? '',
  );
  check(
    'заголовок и колонка имён угаданы',
    /^2:/.test(header) && /Ф\.И\.О\./.test(names),
    `${header} | ${names}`,
  );
  const takes = await page.$$eval('[data-gcol]', (li) =>
    li.map((l) => [
      l.querySelector('b')?.textContent,
      l.querySelector('input[type=checkbox]')?.checked,
    ]),
  );
  check(
    'столбцы с датами взяты, остальные — по выбору',
    JSON.stringify(takes) ===
      JSON.stringify([
        ['05.11', true],
        ['12.11', true],
        ['Контрольная', false],
      ]),
    JSON.stringify(takes),
  );
  // The test column too, with its date.
  const test = page.locator('[data-gcol]').filter({ hasText: 'Контрольная' });
  await test.locator('input[type=checkbox]').check();
  await test.locator('input[type=date]').fill('2026-11-19');

  check(
    'уверенные строки сопоставлены сами',
    (await page.locator('[data-person=exact]').count()) === 4,
  );
  const undecided = await page.locator('[data-undecided]').getAttribute('data-undecided');
  const save = page.locator('button:has-text("в журнал")');
  check(
    'две спорные строки ждут решения, сохранить нельзя',
    undecided === '2' && (await save.isDisabled()),
  );
  await page.screenshot({ path: `${S}/w13-import.png`, fullPage: true });

  const doubts = page.locator('tr[data-person=doubt] select');
  // "Мирзаев Азз" is Мирзаев Азиз; "Петров Сергей" is nobody of this class.
  const mirzaev = await doubts
    .nth(0)
    .locator('option:not([disabled])')
    .first()
    .getAttribute('value');
  await doubts.nth(0).selectOption(mirzaev);
  await doubts.nth(1).selectOption('skip');
  await page.waitForFunction(
    () => document.querySelector('[data-undecided]')?.getAttribute('data-undecided') === '0',
  );
  check('после решения можно сохранить', !(await save.isDisabled()));
  await save.click();
  await page.waitForURL('**/teacher/journal/class-1a');
  await page.waitForSelector('th.day.manual');

  const titles = await page.locator('th.day.manual .topic').allInnerTexts();
  // By date: 05.11, 12.11, then the test on 19.11.
  check(
    'в журнале три новых столбца',
    titles.join('|') === 'Из файла|Из файла|Контрольная',
    titles.join('|'),
  );
  const row = (name) =>
    page.locator('tbody tr').filter({ hasText: name }).locator('td.cell').allInnerTexts();
  const aliev = (await row('Алиев Тимур')).map((c) => c.trim());
  const mirz = (await row('Мирзаев Азиз')).map((c) => c.trim());
  const petrova = (await row('Петрова Алина')).map((c) => c.trim());
  check('оценки на месте: Алиев', aliev.join(' ') === '5 4 5', aliev.join(' '));
  check('и у подтверждённого вручную Мирзаева', mirz.join(' ') === '4 4 3', mirz.join(' '));
  check(
    'пропущенная строка никому не досталась',
    petrova.every((c) => c === '·'),
    petrova.join(' '),
  );

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
