// S2.6 сквозь два настоящих сервера: облако и школьный ПК со своей базой.
// Урок идёт без связи, потом связь возвращается — и урок появляется в облаке ровно один раз.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = require('node:path').resolve(__dirname, '../..');
const S = require('node:path').join(__dirname, 'out');
require('node:fs').mkdirSync(S, { recursive: true });
const CLOUD = 'http://127.0.0.1:3300';
const SCHOOL = 'http://127.0.0.1:3400';
const DEAD = 'http://127.0.0.1:3999'; // сюда никто не отвечает — это «интернет пропал»
const CONFIG = path.join(S, 'data-school', 'config.json');

const out = [];
const check = (name, pass, extra = '') => {
  out.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

function start(name, port, dir, extraEnv, fresh = true) {
  if (fresh) {
    fs.rmSync(path.join(S, dir), { recursive: true, force: true });
    fs.mkdirSync(path.join(S, dir), { recursive: true });
  }
  const child = spawn('node', ['apps/server/dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: path.join(S, dir),
      DATABASE_PATH: path.join(S, dir, 'sinf.db'),
      DEMO_TEACHER_PASSWORD: 'demo1234',
      SESSION_SECRET: 'test-secret-at-least-16-chars',
      SUPERADMIN_EMAIL: '',
      SUPERADMIN_PASSWORD: '',
      PLATFORM_CONFIG_FILE: '',
      PLATFORM_URL: '',
      DEVICE_TOKEN: '',
      LOG_LEVEL: 'warn',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = fs.createWriteStream(path.join(S, `${name}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

async function waitFor(base) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${base} не поднялся`);
}

function client(base) {
  let cookie = '';
  return {
    async call(method, url, body, headers = {}) {
      const res = await fetch(base + url, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) if (c.startsWith('sinf_teacher=')) cookie = c.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, json, text };
    },
  };
}

(async () => {
  const cloud = start('srv-cloud', 3300, 'data-cloud', {});
  await waitFor(CLOUD);
  const c = client(CLOUD);

  // 1. В облаке заводим класс, которого на школьном ПК быть не может
  await c.call('POST', '/api/auth/teacher', { email: 'demo@sinf.local', password: 'demo1234' });
  const made = await c.call('POST', '/api/classes', { name: '7В', grade: 7 });
  const classId = made.json.class.id;
  await c.call('POST', `/api/classes/${classId}/students`, {
    students: [
      { lastName: 'Облаков', firstName: 'Пётр' },
      { lastName: 'Сетева', firstName: 'Нигора' },
      { lastName: 'Кэшев', firstName: 'Игорь' },
    ],
  });
  const me = await c.call('GET', '/api/me');
  const schoolId = me.json.schools[0].id;
  const dev = await c.call('POST', `/api/schools/${schoolId}/devices`, { name: 'ПК-07' });
  const paired = await c.call('POST', '/api/devices/pair', {
    code: dev.json.device.pairingCode,
    appVersion: '0.2.0',
  });
  const token = paired.json.deviceToken;
  check('облако: класс 7В создан и компьютер привязан', !!classId && !!token);

  // 2. Школьный ПК: своя пустая база, адрес платформы — из файла настроек приложения
  fs.rmSync(path.join(S, 'data-school'), { recursive: true, force: true });
  fs.mkdirSync(path.join(S, 'data-school'), { recursive: true });
  const writeConfig = (url) =>
    fs.writeFileSync(
      CONFIG,
      JSON.stringify({
        SessionSecret: 'test-secret-at-least-16-chars',
        TeacherPassword: 'demo1234',
        PlatformUrl: url,
        DeviceToken: token,
      }),
    );
  writeConfig(CLOUD);
  const school = spawnSchool(token);
  await waitFor(SCHOOL);
  const s = client(SCHOOL);
  await new Promise((r) => setTimeout(r, 1500)); // первая синхронизация при старте

  await s.call('POST', '/api/auth/teacher', { email: 'demo@sinf.local', password: 'demo1234' });
  const mine = await s.call('GET', '/api/me');
  const mirrored = mine.json.classes.find((x) => x.name === '7В');
  check(
    'школьный ПК забрал класс из облака',
    !!mirrored,
    mirrored ? `${mirrored.name}, ${mirrored.studentCount} ученика` : 'класса нет',
  );
  check('идентификатор класса тот же, что в облаке', mirrored?.id === classId);

  // 3. Интернет пропал
  writeConfig(DEAD);
  await new Promise((r) => setTimeout(r, 300));

  const started = await s.call('POST', '/api/sessions', { classId, lessonId: 'g10' });
  if (!started.json?.session) throw new Error(`сеанс не создан: ${started.status} ${started.text}`);
  const sessionId = started.json.session.id;
  const details = await s.call('GET', `/api/classes/${classId}`);
  const pupil = details.json.students[0];
  const joined = await s.call('POST', '/api/join', {
    sessionId,
    studentId: pupil.id,
    code: pupil.code,
  });
  check('урок идёт без связи: ученик вошёл', joined.status === 200, `код ответа ${joined.status}`);
  await s.call('POST', `/api/sessions/${sessionId}/end`);
  await new Promise((r) => setTimeout(r, 800));

  const beforeStatus = await s.call('GET', '/api/sync/status');
  check(
    'урок ждёт связи',
    beforeStatus.json.pending === 1,
    `в очереди ${beforeStatus.json.pending}`,
  );
  const cloudBefore = await countInCloud(sessionId);
  check('в облаке урока пока нет', cloudBefore.session === false);

  // 4. Связь вернулась
  writeConfig(CLOUD);
  const t0 = Date.now();
  const sent = await s.call('POST', '/api/sync/now');
  const ms = Date.now() - t0;
  check('после связи очередь пуста', sent.json.pending === 0, `за ${ms} мс`);
  check('ошибок нет', sent.json.lastError === null, String(sent.json.lastError));

  const after = await countInCloud(sessionId);
  check('урок появился в облаке', after.session === true);
  check('посещаемость перенесена', after.attendance === 3, `строк: ${after.attendance}`);

  // 5. Повторная отправка
  await s.call('POST', '/api/sync/now');
  await s.call('POST', '/api/sync/now');
  const twice = await countInCloud(sessionId);
  check(
    'повторная отправка ничего не задваивает',
    twice.attendance === after.attendance && twice.sessions === after.sessions,
    `сеансов ${twice.sessions}, посещаемость ${twice.attendance}`,
  );

  school.kill();
  cloud.kill();
  console.log(out.join('\n'));

  function spawnSchool() {
    // Папка уже подготовлена вместе с файлом настроек — стирать её нельзя.
    return start('srv-school', 3400, 'data-school', { PLATFORM_CONFIG_FILE: CONFIG }, false);
  }

  async function countInCloud(id) {
    const Database = require(
      require.resolve('better-sqlite3', { paths: [path.join(ROOT, 'apps/server')] }),
    );
    const db = new Database(path.join(S, 'data-cloud', 'sinf.db'), { readonly: true });
    const sessions = db.prepare('select count(*) n from sessions where id = ?').get(id).n;
    const attendance = db
      .prepare('select count(*) n from attendance where session_id = ?')
      .get(id).n;
    db.close();
    return { session: sessions > 0, sessions, attendance };
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
