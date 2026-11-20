const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const out = [];
const check = (n, ok, extra = '') =>
  out.push(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`);

// 30 имён в том виде, в каком их даёт Excel: номер, таб, фамилия, таб, имя
const NAMES = [
  'Абдуллаев Жасур',
  'Алиев Тимур',
  'Ахмедова Нигора',
  'Бобоев Санжар',
  'Васильев Пётр',
  'Гафуров Отабек',
  'Данилова Вера',
  'Ергашев Шер',
  'Жумаев Азиз',
  'Зокиров Улугбек',
  'Иванов Артём',
  'Каримова Мадина',
  'Лебедева Ольга',
  'Мирзаев Бекзод',
  'Насырова Дилноза',
  'Орлова Полина',
  'Петрова Алина',
  'Рахимов Фаррух',
  'Саидова Камила',
  'Турсунов Акмал',
  'Умарова Севара',
  'Фёдоров Илья',
  'Хасанов Жахонгир',
  'Цветкова Инна',
  'Чориев Дилшод',
  'Шарипова Гулноза',
  'Эргашева Зилола',
  'Юсупов Руслан',
  'Яковлева Дарья',
  'Абдурахмонов Нодир',
];
const PASTE =
  '№\tФамилия Имя\n' +
  NAMES.map((n, i) => `${i + 1}.\t${n.split(' ')[0]}\t${n.split(' ')[1]}`).join('\n');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // регистрация нового учителя
  await page.goto(`${BASE}/teacher/register`);
  const email = `uch${Date.now()}@example.com`;
  await page.fill('input[autocomplete=name]', 'Новый Учитель');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'parol12345');
  await page.click('button[type=submit]');
  await page.waitForURL('**/teacher');
  await page.waitForSelector('h1');

  const started = Date.now();
  // создание класса
  await page.click('button:has-text("Создать класс")');
  await page.waitForSelector('input[maxlength="20"]');
  await page.fill('input[maxlength="20"]', '5Б');
  await page.selectOption('select', '5');
  await page.click('button:has-text("Создать")');
  await page.waitForURL('**/teacher/class/**', { timeout: 10000 });
  // SPA оставляет старую разметку, пока не отрисуется новая: ждём именно заголовок класса.
  await page.waitForSelector('h1:has-text("5Б")', { timeout: 10000 });
  check('класс создан и открылся', true);

  // вставка списка
  await page.fill('textarea', PASTE);
  await page.waitForTimeout(300);
  const found = await page.locator('text=/Распознано учеников: \\d+/').first().innerText();
  check('разбор списка до отправки', found.includes('30'), found);
  await page.click('button:has-text("Добавить в класс")');
  await page.waitForSelector('tbody tr', { timeout: 10000 });
  await page.waitForTimeout(500);
  const rows = await page.locator('tbody tr').count();
  check('в классе 30 учеников', rows === 30, `строк: ${rows}`);

  const names = await page.locator('tbody tr .name').allInnerTexts();
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  check('список по алфавиту', JSON.stringify(names) === JSON.stringify(sorted));
  const codes = await page.locator('tbody tr .code').allInnerTexts();
  check(
    'у всех есть код',
    codes.every((c) => c.replace(/\s/g, '').length >= 4),
  );

  // карточки
  await page.click('a:has-text("Карточки для печати")');
  await page.waitForURL('**/cards');
  await page.waitForSelector('article.card', { timeout: 10000 });
  await page
    .waitForFunction(() => document.querySelectorAll('article.card').length >= 30, null, {
      timeout: 10000,
    })
    .catch(() => {});
  const elapsed = Math.round((Date.now() - started) / 1000);
  const cards = await page.locator('article.card').count();
  check('карточки напечатались', cards === 30, `карточек: ${cards}`);
  check('от создания класса до карточек меньше минуты', elapsed < 60, `${elapsed} с`);
  await page.screenshot({ path: `${S}/s22-cards.png` });

  // правка и удаление
  await page.goBack();
  await page.waitForSelector('tbody tr');
  await page.locator('tbody tr').first().locator('button:has-text("Изменить")').click();
  await page.locator('tbody tr').first().locator('input').first().fill('Яковлев');
  await page.locator('tbody tr').first().locator('button:has-text("Сохранить")').click();
  await page.waitForTimeout(600);
  const afterRename = await page.locator('tbody tr .name').allInnerTexts();
  check(
    'после правки фамилии список пересортирован',
    afterRename[afterRename.length - 1].startsWith('Яковлев'),
    afterRename[afterRename.length - 1],
  );

  page.on('dialog', (d) => d.accept());
  await page.locator('tbody tr').first().locator('button:has-text("Удалить")').click();
  await page.waitForTimeout(700);
  check('ученик удалён', (await page.locator('tbody tr').count()) === 29);

  // повторная вставка тех же имён не создаёт повторов: двое вернутся (переименованный и удалённый),
  // остальные 28 будут пропущены как уже имеющиеся
  await page.fill('textarea', PASTE);
  await page.click('button:has-text("Добавить в класс")');
  await page.waitForTimeout(900);
  const finalNames = await page.locator('tbody tr .name').allInnerTexts();
  check(
    'повторная вставка не задваивает имена',
    new Set(finalNames).size === finalNames.length,
    `строк: ${finalNames.length}, различных: ${new Set(finalNames).size}`,
  );
  const skipped = await page.locator('text=/уже были в классе/').count();
  check('пропущенные показаны учителю', skipped > 0);

  // урок для нового класса + вход ученика
  await page.goto(`${BASE}/teacher`);
  await page.waitForSelector('h1');
  await page.click('text=Начать урок >> nth=0');
  await page.waitForURL('**/teacher/session/**', { timeout: 10000 });
  const code = (await page.locator('text=/Код урока: ?\\d{4}/').first().innerText()).match(
    /[0-9]{4}/,
  )[0];
  const details = await page.evaluate(async () => {
    const me = await (await fetch('/api/me')).json();
    return await (await fetch(`/api/classes/${me.classes[0].id}`)).json();
  });
  const who = details.students[0];
  const pupil = await (await browser.newContext()).newPage();
  await pupil.goto(`${BASE}/join?code=${code}`);
  await pupil.waitForSelector('.names button');
  await pupil.locator('.names button', { hasText: who.lastName }).first().click();
  await pupil.waitForSelector('.choice, input', { timeout: 8000 });
  // 5 класс — цифровой код
  for (const digit of who.code) {
    await pupil.locator('.choice', { hasText: digit }).first().click();
    await pupil.waitForTimeout(120);
  }
  await pupil.waitForSelector('text=Начать', { timeout: 8000 });
  check('ученик нового класса вошёл по цифровому коду', true);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
  process.exit(out.some((l) => l.startsWith('❌')) ? 1 : 0);
})();
