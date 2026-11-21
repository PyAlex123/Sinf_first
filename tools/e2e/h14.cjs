// H14 (STAGE3.md): screen broadcast. The teacher's app and a child's app are imitated: a fake
// WebView2 channel records what the pages ask of the app, and a node WebSocket plays the app that
// films the screen, sending real JPEG frames. The server must run with CLASSROOM_MODE=1 and
// HOST_TOKEN=e2e-host-token-0123456789 (see tools/e2e/README.md).
const { chromium } = require('playwright');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const serverRequire = createRequire(join(__dirname, '../../apps/server/package.json'));
const WebSocket = serverRequire('ws');
const sharp = serverRequire('sharp');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const HOST_TOKEN = process.env.HOST_TOKEN ?? 'e2e-host-token-0123456789';
const S = join(__dirname, 'out');
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A frame in the broadcast format (packages/shared/src/screen.ts), built here for the test. */
function frame({ keyframe, seq, width, height, rects, cursor }) {
  const size = 24 + rects.reduce((s, r) => s + 12 + r.jpeg.length, 0);
  const b = Buffer.alloc(size);
  b.write('SNF1', 0, 'ascii');
  b.writeUInt8(1, 4);
  b.writeUInt8(keyframe ? 1 : 0, 5);
  b.writeUInt32LE(0, 6);
  b.writeUInt32LE(seq, 10);
  b.writeUInt16LE(width, 14);
  b.writeUInt16LE(height, 16);
  b.writeInt16LE(cursor ? cursor.x : -1, 18);
  b.writeInt16LE(cursor ? cursor.y : -1, 20);
  b.writeUInt16LE(rects.length, 22);
  let at = 24;
  for (const r of rects) {
    b.writeUInt16LE(r.x, at);
    b.writeUInt16LE(r.y, at + 2);
    b.writeUInt16LE(r.w, at + 4);
    b.writeUInt16LE(r.h, at + 6);
    b.writeUInt32LE(r.jpeg.length, at + 8);
    r.jpeg.copy(b, at + 12);
    at += 12 + r.jpeg.length;
  }
  return b;
}
const jpeg = (w, h, rgb) =>
  sharp({
    create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

/** A page with the classroom app's bridge and a channel that records what the page asks for. */
async function appPage(browser, host) {
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage();
  await page.addInitScript((h) => {
    window.sinfHost = h;
    window.__toHost = [];
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (m) => {
        window.__toHost.push(m);
        if (m.type === 'thumbs' && m.on) {
          // A thumbnail so the teacher can open the child's screen large.
          const c = document.createElement('canvas');
          c.width = 32;
          c.height = 18;
          const data = c.toDataURL('image/jpeg').split(',')[1];
          listeners.forEach((l) => l({ data: { type: 'thumb', jpeg: data } }));
        }
      },
      addEventListener: (_t, l) => listeners.push(l),
      removeEventListener: () => undefined,
    };
  }, host);
  return page;
}
const asked = (page, type) =>
  page.evaluate((t) => window.__toHost.filter((m) => m.type === t), type);
/** The colour of the middle of the broadcast canvas, or null when nothing is drawn. */
const colour = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.screen canvas');
    if (!c || !c.width) return null;
    const [r, g, b] = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return [r, g, b];
  });
const near = (got, want) => !!got && got.every((v, i) => Math.abs(v - want[i]) < 30);

function source(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const said = [];
    ws.on('message', (d) => said.push(String(d)));
    ws.on('open', () => resolve({ ws, said }));
    ws.on('error', reject);
    ws.on('close', (code) => said.push(`closed ${code}`));
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const teacher = await appPage(browser, {
    isDesktop: true,
    role: 'teacher',
    version: '0.1.0.0',
    lanUrl: BASE,
  });
  teacher.on('console', (m) => m.type() === 'error' && errors.push(`учитель: ${m.text()}`));
  await teacher.goto(`${BASE}/teacher/login`);
  await teacher.fill('input[type=email]', 'demo@sinf.local');
  await teacher.fill('input[type=password]', 'demo1234');
  await teacher.click('button[type=submit]');
  await teacher.waitForSelector('h2:has-text("Уроки")');
  const { sessionId, kids } = await teacher.evaluate(async () => {
    const json = (m, u, b) =>
      fetch(u, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    const details = await json('GET', '/api/classes/class-1a');
    const { session } = await json('POST', '/api/sessions', {
      classId: 'class-1a',
      lessonId: 'k10',
    });
    const kids = [];
    for (const [i, last] of ['Алиев', 'Каримова'].entries()) {
      const s = details.students.find((x) => x.lastName === last);
      const j = await json('POST', '/api/join', {
        sessionId: session.id,
        studentId: s.id,
        code: s.code,
        pc: `ПК-0${i + 5}`,
      });
      kids.push({ id: s.id, token: j.token });
    }
    return { sessionId: session.id, kids };
  });
  const students = [];
  for (const [i, kid] of kids.entries()) {
    const p = await appPage(browser, {
      isDesktop: true,
      role: 'student',
      version: '0.1.0.0',
      pcName: `ПК-0${i + 5}`,
    });
    p.on('console', (m) => m.type() === 'error' && errors.push(`ученик ${i + 1}: ${m.text()}`));
    await p.goto(`${BASE}/join`);
    await p.evaluate(
      ([id, tk]) => sessionStorage.setItem(`sinf.participant.${id}`, tk),
      [sessionId, kid.token],
    );
    await p.goto(`${BASE}/s/${sessionId}`);
    students.push(p);
  }
  await teacher.goto(`${BASE}/teacher/session/${sessionId}`);
  await teacher.waitForSelector('.demobox');

  // ---------- "Мой экран: весь экран"
  await teacher.locator('button:has-text("Мой экран: весь экран")').click();
  await teacher.waitForSelector('text=Ученики видят ваш экран');
  check(
    'учитель включил «Мой экран», панель просит приложение снимать',
    (await asked(teacher, 'share')).some((m) => m.on && m.sessionId === sessionId),
  );
  const host = await source(`${BASE.replace('http', 'ws')}/ws/demo?session=${sessionId}`, {
    'x-host-token': HOST_TOKEN,
  });
  await wait(300);
  check('сервер попросил целый кадр', host.said.includes('keyframe'));
  host.ws.send(
    frame({
      keyframe: true,
      seq: 1,
      width: 1280,
      height: 720,
      cursor: { x: 640, y: 360 },
      rects: [{ x: 0, y: 0, w: 1280, h: 720, jpeg: await jpeg(1280, 720, [200, 30, 30]) }],
    }),
  );
  await students[0].waitForSelector('.demo.full canvas');
  await students[0].waitForFunction(() => document.querySelector('.screen canvas')?.width === 1280);
  await wait(300);
  check(
    'у учеников экран учителя на весь экран, нарисован красный кадр',
    near(await colour(students[0]), [200, 30, 30]) &&
      near(await colour(students[1]), [200, 30, 30]),
    JSON.stringify(await colour(students[0])),
  );
  check(
    'на весь экран — ввод ученика заблокирован',
    (await asked(students[0], 'lock')).at(-1)?.on === true,
  );
  check('виден курсор учителя', (await students[0].locator('.cursor').count()) === 1);
  // Only the middle changed: a small green piece.
  await wait(200);
  host.ws.send(
    frame({
      keyframe: false,
      seq: 2,
      width: 1280,
      height: 720,
      cursor: null,
      rects: [{ x: 560, y: 320, w: 160, h: 80, jpeg: await jpeg(160, 80, [30, 180, 30]) }],
    }),
  );
  await wait(500);
  check(
    'изменившийся кусок дорисован поверх',
    near(await colour(students[1]), [30, 180, 30]),
    JSON.stringify(await colour(students[1])),
  );
  await students[0].screenshot({ path: `${S}/141-h14-fullscreen.png` });

  await teacher.locator('button:has-text("Остановить показ")').click();
  await students[0].waitForSelector('.demo', { state: 'detached' });
  await wait(300);
  check(
    '«Остановить показ»: экран учителя исчез, ввод разблокирован',
    (await asked(students[0], 'lock')).at(-1)?.on === false,
  );
  check(
    'приложение учителя остановлено',
    host.said.includes('stop') || host.said.some((s) => s.startsWith('closed')),
  );

  // ---------- "В окне"
  await teacher.locator('button:has-text("Мой экран: в окне")').click();
  const host2 = await source(`${BASE.replace('http', 'ws')}/ws/demo?session=${sessionId}`, {
    'x-host-token': HOST_TOKEN,
  });
  await wait(200);
  host2.ws.send(
    frame({
      keyframe: true,
      seq: 1,
      width: 1280,
      height: 720,
      cursor: null,
      rects: [{ x: 0, y: 0, w: 1280, h: 720, jpeg: await jpeg(1280, 720, [30, 30, 200]) }],
    }),
  );
  await students[0].waitForSelector('.demo:not(.full) canvas');
  await wait(400);
  check(
    '«в окне» — панель в углу, ввод не заблокирован',
    near(await colour(students[0]), [30, 30, 200]) &&
      (await asked(students[0], 'lock')).at(-1)?.on === false,
  );
  await students[0].screenshot({ path: `${S}/142-h14-window.png` });
  await teacher.locator('button:has-text("Остановить показ")').click();
  await wait(300);
  host2.ws.close();

  // ---------- a child's screen to the class
  await teacher.waitForSelector('.tile:has-text("ПК-05") .act[aria-label="Экран крупно"]', {
    timeout: 10000,
  });
  await teacher.locator('.tile:has-text("ПК-05") .act[aria-label="Экран крупно"]').click();
  await teacher.locator('dialog.zoom button:has-text("Показать всем")').click();
  await students[0].waitForSelector('text=Твой экран показывают классу');
  const share = (await asked(students[0], 'share')).at(-1);
  check(
    'компьютер показываемого ученика получил команду снимать, с его токеном',
    share?.on === true && share.token === kids[0].token,
  );
  const child = await source(
    `${BASE.replace('http', 'ws')}/ws/demo?session=${sessionId}&participant=${encodeURIComponent(share.token)}`,
    {},
  );
  await wait(200);
  child.ws.send(
    frame({
      keyframe: true,
      seq: 1,
      width: 1280,
      height: 720,
      cursor: null,
      rects: [{ x: 0, y: 0, w: 1280, h: 720, jpeg: await jpeg(1280, 720, [240, 200, 20]) }],
    }),
  );
  await students[1].waitForSelector('.demo.full canvas');
  await wait(400);
  check('другой ученик видит экран одноклассника', near(await colour(students[1]), [240, 200, 20]));
  check('учитель видит его в своей панели', near(await colour(teacher), [240, 200, 20]));
  check('сам ученик своего экрана не видит', (await students[0].locator('.demo').count()) === 0);
  await teacher.screenshot({ path: `${S}/143-h14-child.png` });

  // A stranger with no right to film is turned away.
  const stranger = await source(
    `${BASE.replace('http', 'ws')}/ws/demo?session=${sessionId}&participant=${encodeURIComponent(kids[1].token)}`,
    {},
  ).catch(() => null);
  await wait(300);
  check('чужой источник не принят', !stranger || stranger.said.some((s) => s === 'closed 4001'));
  await teacher.locator('button:has-text("Остановить показ")').click();
  await wait(300);

  check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  await browser.close();
  process.exit();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
