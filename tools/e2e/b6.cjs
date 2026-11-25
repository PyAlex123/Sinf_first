// B6 (STAGE6.md): updates of the Windows app on the platform. The superadmin uploads a signed
// update (update.json + installer) in /admin; any computer then sees it at /api/updates/latest and
// downloads exactly those bytes; a file that is not the one update.json describes is refused; the
// superadmin deletes a version. The server must run with SUPERADMIN_EMAIL=root@sinf.uz and
// SUPERADMIN_PASSWORD=root-pass-1234 (no UPDATE_PUBLIC_KEY: the page then says the computers alone
// check the signature — the signature itself is covered by apps/server/test/updates.test.ts).
const { chromium } = require('playwright');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const S = join(__dirname, 'out');
mkdirSync(S, { recursive: true });
const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

/** What CI makes with tools/sign-update.mjs, with a throwaway key. */
function release(version, bytes) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const message = `sinf-update:${version}:${sha256}:${bytes.length}`;
  const signature = sign('sha256', Buffer.from(message), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  const file = `Sinf-update-${version}.exe`;
  return { manifest: { version, file, sha256, size: bytes.length, signature }, bytes, file };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/teacher/login`);
  await page.fill('input[type=email]', 'root@sinf.uz');
  await page.fill('input[type=password]', 'root-pass-1234');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/teacher`);
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('h2:has-text("Обновления Windows-приложения")');
  check('у суперадмина есть «Обновления»', true);
  check(
    'без ключа сайт честно говорит, что подпись проверяют только компьютеры',
    (await page.locator('.notice:has-text("UPDATE_PUBLIC_KEY")').count()) === 1,
  );

  const r = release('0.3.900', Buffer.alloc(2 * 1024 * 1024, 0x4d));
  const json = {
    name: 'update.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(r.manifest)),
  };
  await page.locator('input[data-field=update-json]').setInputFiles(json);
  await page
    .locator('input[data-field=update-exe]')
    .setInputFiles({ name: r.file, mimeType: 'application/octet-stream', buffer: r.bytes });
  await page.locator('button:has-text("Загрузить")').click();
  await page.waitForSelector('.notice:has-text("Версия 0.3.900 загружена")');
  check(
    'загружено: версия в списке и «раздаётся сейчас»',
    (await page.locator('[data-update="0.3.900"]').innerText()).includes('раздаётся сейчас'),
  );
  await page.screenshot({ path: `${S}/b6-admin-updates.png`, fullPage: true });

  // Any computer, without logging in.
  const anon = await browser.newContext();
  const latest = await (await anon.request.get(`${BASE}/api/updates/latest`)).json();
  check(
    'компьютер видит её в /api/updates/latest',
    latest.update?.version === '0.3.900' &&
      latest.update.sha256 === r.manifest.sha256 &&
      latest.busy === false,
    JSON.stringify({ version: latest.update?.version, busy: latest.busy }),
  );
  const file = await anon.request.get(`${BASE}/api/updates/0.3.900/installer`);
  const got = await file.body();
  check(
    'и скачивает ровно те байты',
    file.ok() && createHash('sha256').update(got).digest('hex') === r.manifest.sha256,
  );

  // The same size, other bytes: refused by the server, nothing changes.
  const forged = Buffer.from(r.bytes);
  forged[100] = 0x58;
  const r2 = release('0.3.901', forged);
  const manifest2 = { ...r2.manifest, sha256: r.manifest.sha256 };
  await page
    .locator('input[data-field=update-json]')
    .setInputFiles({ ...json, buffer: Buffer.from(JSON.stringify(manifest2)) });
  await page
    .locator('input[data-field=update-exe]')
    .setInputFiles({ name: r2.file, mimeType: 'application/octet-stream', buffer: forged });
  await page.locator('button:has-text("Загрузить")').click();
  await page.waitForSelector('.notice:has-text("Файл не тот")');
  check('подменённый файл отклонён', (await page.locator('[data-update="0.3.901"]').count()) === 0);

  // Another file than update.json names: the page itself says so before uploading.
  await page.locator('input[data-field=update-exe]').setInputFiles({
    name: 'other.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(10),
  });
  await page.locator('input[data-field=update-json]').setInputFiles(json);
  await page.locator('button:has-text("Загрузить")').click();
  await page.waitForSelector('.notice:has-text("Размер не совпадает")');
  check('файл не того размера — подсказка «нужен файл Sinf-update-0.3.900.exe»', true);

  page.once('dialog', (d) => void d.accept());
  await page.locator('[data-update="0.3.900"] button:has-text("Удалить")').click();
  await page.waitForSelector('text=Обновлений ещё не загружено.');
  const after = await (await anon.request.get(`${BASE}/api/updates/latest`)).json();
  check('удалённая версия больше не раздаётся', after.update === null);

  writeFileSync(join(S, 'b6-latest.json'), JSON.stringify(latest, null, 2));
  // The refused upload answers 400 on purpose; the browser logs that.
  const real = errors.filter((e) => !e.includes('status of 400'));
  check('других ошибок в консоли нет', real.length === 0, real.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  console.log(out.join('\n'));
  process.exit(1);
});
