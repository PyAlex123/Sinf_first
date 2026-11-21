// W1–W2 (STAGE4.md): a teacher's own lesson from the template, the constructor, the preview and a
// lesson held with it. Server: `pnpm build && pnpm start`.
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
// A 64×32 orange PNG made by hand: no image library needed.
function png(w, h) {
  const zlib = require('node:zlib');
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0)]);
  for (let x = 0; x < w; x += 1) row.set([255, 120, 0], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'demo@sinf.local');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Мои уроки');

  // ---------- a new lesson from the template
  await page.locator('section.own button:has-text("Новый урок")').click();
  await page.fill('section.own input[data-field=title]', 'Клавиатура <b>и</b> мышь');
  await page.locator('section.own button:has-text("Создать и открыть")').click();
  await page.waitForURL(/\/teacher\/lessons\/u-[0-9a-f]{32}\/edit$/);
  const lessonId = page.url().split('/').at(-2);
  await page.waitForSelector('.timeline .seg');
  const segs = await page.locator('.timeline .seg b').allInnerTexts();
  check(
    'шаблон 45 минут: теория, практика, викторина, итоги',
    JSON.stringify(segs) === JSON.stringify(['Теория', 'Практика', 'Викторина', 'Итоги']),
    segs.join(', '),
  );
  check('всего 45 минут', (await page.locator('.total').innerText()).includes('45'));

  // ---------- the constructor
  await page.fill('input[data-field=stage-minutes]', '12');
  await page.locator('button:has-text("+ Слайд")').click();
  await page.fill('input[data-field=slide-title]', 'Что такое мышь');
  await page.fill('textarea[data-field=slide-text]', 'Мышь двигает курсор.\n\nУ неё есть кнопки.');
  await page.fill('textarea[data-field=slide-bullets]', 'левая кнопка\nправая кнопка\nколёсико');
  await page.locator('input[data-field=slide-image]').setInputFiles({
    name: 'mouse.png',
    mimeType: 'image/png',
    buffer: png(64, 32),
  });
  await page.waitForSelector('.image img', { timeout: 8000 });
  check('картинка уменьшена в браузере и загружена', true);
  await page.locator('input[data-toggle=greeting]').check();
  await page.waitForSelector('.status[data-status=saved]', { timeout: 10000 });
  check(
    'этап «Приветствие» встал первым',
    (await page.locator('.timeline .seg b').first().innerText()) === 'Приветствие',
  );
  check('изменения сохранились сами', (await page.locator('.status').innerText()) === 'Сохранено');
  await page.screenshot({ path: `${S}/w2-editor.png` });

  // ---------- after a reload everything is there
  await page.reload();
  await page.waitForSelector('.timeline .seg');
  await page.locator('.seg[data-stage=theory]').click();
  const slides = await page.locator('ol.blocks li').count();
  check('после перезагрузки: два слайда в теории', slides === 2, String(slides));
  await page.locator('ol.blocks li').nth(1).locator('button.pick').click();
  check(
    'текст слайда сохранён',
    (await page.locator('textarea[data-field=slide-text]').inputValue()).includes('кнопки'),
  );
  check(
    'минуты этапа сохранены',
    (await page.locator('input[data-field=stage-minutes]').inputValue()) === '12',
  );

  // ---------- the preview: the lesson as the class will see it
  await page.locator('button:has-text("Просмотр")').click();
  await page.waitForSelector('.previewer .slide');
  const shown = await page.locator('.previewer .slide').innerText();
  check(
    'просмотр показывает слайд, который правится',
    shown.includes('Что такое мышь'),
    shown.slice(0, 60),
  );
  check('список на слайде', (await page.locator('.previewer .slide li').count()) === 3);
  check('картинка на слайде', (await page.locator('.previewer .slide image').count()) === 1);
  await page.screenshot({ path: `${S}/w2-preview.png` });
  await page.locator('.previewer button.closer').click();

  // ---------- typed text never becomes markup
  const html = await page.evaluate(async (id) => {
    const lesson = await fetch(`/api/lessons/${id}`).then((r) => r.json());
    return lesson.screens.map((s) => s.html ?? '').join('');
  }, lessonId);
  check('название с <b> — текст, не разметка', !html.includes('<b>') && html.includes('&lt;b&gt;'));

  // ---------- a lesson held with it
  await page.goto(`${BASE}/teacher`);
  await page.waitForSelector(`li[data-lesson="${lessonId}"]`);
  await page.locator(`li[data-lesson="${lessonId}"] button:has-text("Начать")`).click();
  await page.waitForURL(/\/teacher\/session\//);
  await page.waitForSelector('text=Приветствие', { timeout: 8000 });
  check('урок учителя начинается с классом, этапы на месте', true);
  check(
    'кнопки «Сценарий» у своего урока нет',
    (await page.locator('button:has-text("Сценарий")').count()) === 0,
  );
  await page.screenshot({ path: `${S}/w2-session.png` });
  await page.locator('button:has-text("Завершить урок")').click();

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
