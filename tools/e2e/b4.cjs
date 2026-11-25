// B4 (STAGE6.md): slides from a PowerPoint file — titles, points, text boxes and pictures become
// ordinary slides of the lesson builder. The presentation is the checkers' fixture `lesson.pptx`.
const { chromium } = require('playwright');
const { mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
mkdirSync(S, { recursive: true });
const PPTX = join(__dirname, '../../packages/checkers/fixtures/pptx/lesson.pptx');
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

  const lessonId = await page.evaluate(async () => {
    const r = await fetch('/api/authored-lessons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Урок из PowerPoint', grade: 5, template: 'empty' }),
    });
    return (await r.json()).id;
  });
  await page.goto(`${BASE}/teacher/lessons/${lessonId}/edit`);
  await page.waitForSelector('input[data-field=pptx]', { state: 'attached' });
  check(
    'кнопка «Слайды из PowerPoint» рядом с PDF',
    (await page.locator('label.file:has-text("Слайды из PowerPoint")').count()) === 1,
  );

  const started = Date.now();
  await page.locator('input[data-field=pptx]').setInputFiles({
    name: 'Компьютер.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: readFileSync(PPTX),
  });
  await page.waitForFunction(() => document.querySelectorAll('ol.blocks li').length === 5, null, {
    timeout: 30000,
  });
  check('четыре слайда презентации (плюс титульный)', true, `${Date.now() - started} мс`);
  await page.waitForSelector('.status[data-status=saved]', { timeout: 10000 });

  const blocks = await page.evaluate(async (id) => {
    const lesson = await fetch(`/api/authored-lessons/${id}`).then((r) => r.json());
    const slides = lesson.doc.stages[0].blocks.slice(1);
    const pictures = [];
    for (const b of slides.filter((s) => s.image)) {
      const r = await fetch(`/content/_assets/${b.image.sha}.${b.image.ext}`);
      pictures.push({
        size: (await r.arrayBuffer()).byteLength,
        width: b.image.width,
        type: r.headers.get('content-type'),
      });
    }
    return {
      slides: slides.map((s) => ({
        title: s.title,
        text: s.text,
        bullets: s.bullets,
        image: !!s.image,
      })),
      pictures,
    };
  }, lessonId);
  const [title, points, monitor, picture] = blocks.slides;
  check(
    'заголовок и подзаголовок титульного слайда',
    title?.title === 'Компьютер и его части' && title?.text === 'Урок 1',
    JSON.stringify(title),
  );
  check(
    'пункты списка стали пунктами',
    points?.title === 'Устройства ввода' &&
      JSON.stringify(points?.bullets) ===
        JSON.stringify(['Клавиатура', 'Мышь', 'Микрофон', 'Сканер']),
    JSON.stringify(points),
  );
  check(
    'надпись и картинка слайда',
    monitor?.title === 'Монитор' && monitor?.text === 'Показывает изображение' && monitor?.image,
    JSON.stringify(monitor),
  );
  check(
    'слайд из одной картинки',
    picture?.title === '' && picture?.image,
    JSON.stringify(picture),
  );
  check(
    'картинки — WebP в бюджете слайда',
    blocks.pictures.length === 2 &&
      blocks.pictures.every(
        (p) => p.type === 'image/webp' && p.size <= 150 * 1024 && p.width <= 1600,
      ),
    JSON.stringify(blocks.pictures),
  );

  // The slides are the builder's own: open one and edit it.
  await page.locator('ol.blocks li').nth(2).click();
  const field = page.locator('[data-field=slide-title]');
  check(
    'слайд можно править',
    (await field.inputValue()) === 'Устройства ввода',
    await field.inputValue(),
  );

  await page.locator('button:has-text("Просмотр")').click();
  await page.waitForSelector('.previewer .slide');
  await page.screenshot({ path: `${S}/b4-pptx-slide.png` });
  await page.locator('.previewer button.closer').click();

  // The old binary .ppt, or anything else: a clear message, nothing added.
  await page.locator('input[data-field=pptx]').setInputFiles({
    name: 'old.ppt',
    mimeType: 'application/vnd.ms-powerpoint',
    buffer: Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(504),
    ]),
  });
  await page.waitForSelector('.notice:has-text("не открылся")', { timeout: 15000 });
  check('старый .ppt — понятное сообщение', (await page.locator('ol.blocks li').count()) === 5);

  check('ошибок в консоли нет', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
