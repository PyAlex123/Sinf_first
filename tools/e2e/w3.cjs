// W3 (STAGE4.md): slides from a PDF, drawn in the teacher's browser by pdf.js. The PDF is made here
// by hand: three pages, each a coloured box and a line of text.
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

/** A minimal valid PDF: 16:9 pages, Helvetica text, correct cross-reference table. */
function makePdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  pages.forEach(([r, g, b], i) => {
    const stream = `${r} ${g} ${b} rg 60 60 840 420 re f 0 0 0 rg BT /F1 64 Tf 120 260 Td (Page ${i + 1}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 960 540] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

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
      body: JSON.stringify({ title: 'Урок из PDF', grade: 7, template: 'empty' }),
    });
    return (await r.json()).id;
  });
  await page.goto(`${BASE}/teacher/lessons/${lessonId}/edit`);
  await page.waitForSelector('input[data-field=pdf]', { state: 'attached' });

  const started = Date.now();
  await page.locator('input[data-field=pdf]').setInputFiles({
    name: 'slides.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf([
      [1, 0.4, 0],
      [0, 0.5, 1],
      [0.1, 0.7, 0.3],
    ]),
  });
  await page.waitForFunction(() => document.querySelectorAll('ol.blocks li').length === 4, null, {
    timeout: 30000,
  });
  check('три страницы стали тремя слайдами (плюс титульный)', true, `${Date.now() - started} мс`);
  await page.waitForSelector('.status[data-status=saved]', { timeout: 10000 });

  const sizes = await page.evaluate(async (id) => {
    const lesson = await fetch(`/api/authored-lessons/${id}`).then((r) => r.json());
    const images = lesson.doc.stages[0].blocks.filter((b) => b.image).map((b) => b.image);
    const bytes = [];
    for (const im of images) {
      const r = await fetch(`/content/_assets/${im.sha}.${im.ext}`);
      bytes.push({
        size: (await r.arrayBuffer()).byteLength,
        width: im.width,
        type: r.headers.get('content-type'),
      });
    }
    return bytes;
  }, lessonId);
  check(
    'каждая страница — WebP не шире 1600 px и не больше 150 КБ',
    sizes.length === 3 &&
      sizes.every((s) => s.width <= 1600 && s.size <= 150 * 1024 && s.type === 'image/webp'),
    JSON.stringify(sizes),
  );

  await page.locator('button:has-text("Просмотр")').click();
  await page.waitForSelector('.previewer .slide image');
  const box = await page.locator('.previewer .slide svg').boundingBox();
  check(
    'страница на слайде во весь экран',
    !!box && box.width > 900,
    box ? `${Math.round(box.width)} px` : '',
  );
  await page.screenshot({ path: `${S}/w3-pdf-slide.png` });
  await page.locator('.previewer button.closer').click();

  // A broken file says so, and nothing is added.
  await page.locator('input[data-field=pdf]').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 nothing here'),
  });
  await page.waitForSelector('.notice:has-text("не открылся")', { timeout: 15000 });
  check('битый PDF — понятное сообщение', (await page.locator('ol.blocks li').count()) === 4);

  const real = errors.filter((e) => !e.includes('Invalid PDF') && !e.includes('PDF'));
  check('ошибок в консоли нет', real.length === 0, real.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
