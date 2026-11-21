// H11 (STAGE3.md, PLAN.md 7.1 and 7.7): a classroom of 30 computers against one lesson server.
//
// What it does, against a running server (`pnpm build && pnpm start`, or the teacher's Sinf):
//   1. makes (or reuses) a class "Нагрузка-30" of 30 children and starts lesson g10 for it;
//   2. 30 "computers" log in and open the lesson socket, as the classroom app does;
//   3. measures how long a slide change and a quiz question take to reach all 30 (goal < 300 ms);
//   4. the same while all 30 send thumbnails (30 KB every 3 s), as when the teacher's panel is open;
//   5. 30 screenshots of ~300 KB at once (only where CLASSROOM_MODE is on, as on the teacher's PC);
//   6. the server's memory and processor time, when it runs on this machine (Linux: found by itself;
//      elsewhere pass SERVER_PID, or watch node.exe in the Task Manager).
//
// Usage:  node tools/load/classroom.cjs
//         BASE=http://192.168.1.15:3000 PASSWORD=<teacher password> STUDENTS=30 node tools/load/classroom.cjs
// The report goes to the screen and to tools/load/out/report-<time>.json.
const { createRequire } = require('node:module');
const { mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { execSync } = require('node:child_process');

// `ws` sends the teacher's cookie on the socket, which a browser-style WebSocket cannot.
const WebSocket = createRequire(join(__dirname, '../../apps/server/package.json'))('ws');

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.EMAIL ?? 'demo@sinf.local';
const PASSWORD = process.env.PASSWORD ?? 'demo1234';
const STUDENTS = Number(process.env.STUDENTS ?? 30);
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const THUMB_SECONDS = Number(process.env.THUMB_SECONDS ?? 30);
const CLASS_NAME = 'Нагрузка-30';
const V = 1;
const OUT = join(__dirname, 'out');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return { n: 0, p50: null, p95: null, max: null };
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    n: s.length,
    p50: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    max: Math.round(s.at(-1)),
  };
}

// ---------- the server's own resources

function serverPid() {
  if (process.env.SERVER_PID) return Number(process.env.SERVER_PID);
  if (process.platform !== 'linux') return null;
  try {
    const out = execSync('pgrep -f "server/dist/index.js"').toString();
    // The node process itself, not the shell or pnpm that started it.
    const pids = out.trim().split('\n').map(Number);
    return (
      pids.find((p) => {
        try {
          return readFileSync(`/proc/${p}/comm`, 'utf8').trim() === 'node';
        } catch {
          return false;
        }
      }) ?? null
    );
  } catch {
    return null;
  }
}

function sample(pid) {
  if (!pid || process.platform !== 'linux') return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const ticks = Number(stat[11]) + Number(stat[12]);
    const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1];
    return { at: now(), cpuMs: (ticks * 1000) / 100, rssMb: Math.round(Number(rss) / 1024) };
  } catch {
    return null;
  }
}

function usage(a, b) {
  if (!a || !b) return null;
  return {
    cpuPercentOfOneCore: Math.round((100 * (b.cpuMs - a.cpuMs)) / (b.at - a.at)),
    rssMb: b.rssMb,
  };
}

// ---------- HTTP

let cookie = '';
async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok && !headers['x-allow-fail']) {
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

async function login() {
  const res = await api('POST', '/api/auth/teacher', { email: EMAIL, password: PASSWORD });
  const c = res.setCookie.find((x) => x.startsWith('sinf_teacher='));
  if (!c) throw new Error('no teacher cookie');
  cookie = c.split(';')[0];
}

async function loadClass() {
  const me = (await api('GET', '/api/me')).json;
  let cls = me.classes.find((c) => c.name === CLASS_NAME);
  if (!cls) {
    // Grade 5: digit codes, as in an ordinary computer class.
    cls = (await api('POST', '/api/classes', { name: CLASS_NAME, grade: 5 })).json.class;
  }
  let details = (await api('GET', `/api/classes/${cls.id}`)).json;
  const missing = STUDENTS - details.students.length;
  if (missing > 0) {
    const students = Array.from({ length: missing }, (_, i) => ({
      lastName: `Нагрузкин${String(details.students.length + i + 1).padStart(2, '0')}`,
      firstName: 'Ученик',
    }));
    await api('POST', `/api/classes/${cls.id}/students`, { students });
    details = (await api('GET', `/api/classes/${cls.id}`)).json;
  }
  return { classId: cls.id, students: details.students.slice(0, STUDENTS) };
}

// ---------- sockets

function wsUrl(sessionId, role, token) {
  const u = new URL(BASE.replace(/^http/, 'ws') + '/ws');
  u.searchParams.set('session', sessionId);
  u.searchParams.set('role', role);
  if (token) u.searchParams.set('participant', token);
  return u.toString();
}

function connect(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers, perMessageDeflate: false });
    const client = { ws, listeners: new Set(), received: 0, bytesIn: 0 };
    ws.on('message', (data) => {
      client.received += 1;
      client.bytesIn += data.length;
      const t = now();
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      for (const l of client.listeners) l(m, t);
    });
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

const send = (client, message) => client.ws.send(JSON.stringify({ v: V, ...message }));

/** Time from `trigger()` until every student has seen a message matching `match`. */
async function broadcastLatency(students, trigger, match, timeoutMs = 5000) {
  const times = new Map();
  const start = now();
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    for (const s of students) {
      const l = (m, t) => {
        if (!match(m) || times.has(s)) return;
        times.set(s, t - start);
        if (times.size === students.length) {
          clearTimeout(timer);
          resolve();
        }
      };
      s.listeners.add(l);
      s.cleanup = () => s.listeners.delete(l);
    }
  });
  trigger();
  await done;
  for (const s of students) s.cleanup?.();
  return { latencies: [...times.values()], missed: students.length - times.size };
}

// ---------- a JPEG of a given size, without any image library

function fakeJpeg(bytes) {
  const b = Buffer.alloc(bytes, 0x55);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe0;
  return b;
}

// ---------- the run

(async () => {
  const report = { base: BASE, students: STUDENTS, startedAt: new Date().toISOString() };
  const pid = serverPid();
  report.serverPid = pid;

  await login();
  const { classId, students: roster } = await loadClass();
  const session = (await api('POST', '/api/sessions', { classId, lessonId: 'g10' })).json.session;
  const sessionId = session.id;
  console.log(`урок ${sessionId}, класс ${CLASS_NAME}, учеников ${roster.length}`);

  const idle = sample(pid);

  // 1. Everyone logs in at once, as when the teacher starts the lesson.
  let t0 = now();
  const tokens = await Promise.all(
    roster.map((s, i) =>
      api('POST', '/api/join', {
        sessionId,
        studentId: s.id,
        code: s.code,
        pc: `ПК-${String(i + 1).padStart(2, '0')}`,
      }).then((r) => r.json.token),
    ),
  );
  const students = await Promise.all(tokens.map((t) => connect(wsUrl(sessionId, 'student', t))));
  report.loginAllMs = Math.round(now() - t0);
  const teacher = await connect(wsUrl(sessionId, 'teacher'), { cookie });
  await sleep(500);
  const afterLogin = sample(pid);
  report.serverAfterLogin = afterLogin && { rssMb: afterLogin.rssMb };

  // 2. Slide changes reaching all computers.
  const slide = [];
  let missed = 0;
  for (let i = 1; i <= ROUNDS; i += 1) {
    const r = await broadcastLatency(
      students,
      () => send(teacher, { type: 'teacher.screen.set', index: i % 10 }),
      (m) => m.type === 'screen.changed' && m.index === i % 10,
    );
    slide.push(...r.latencies);
    missed += r.missed;
    await sleep(100);
  }
  report.slideMs = { ...stats(slide), missed };

  // 3. A quiz question reaching all computers, and every child answering.
  const quiz = [];
  missed = 0;
  let answers = 0;
  // Each child answers each question once, a moment after it appears.
  const answerOnQuestion = (s) => (m) => {
    if (m.type === 'quiz.changed' && m.quiz?.phase === 'question') {
      const q = m.quiz.questionIndex;
      if (s.answered === q) return;
      s.answered = q;
      setTimeout(
        () => {
          send(s, {
            type: 'student.quiz.answer',
            questionIndex: q,
            optionIndex: Math.floor(Math.random() * 2),
          });
          answers += 1;
        },
        200 + Math.random() * 1500,
      );
    }
  };
  const answerers = students.map((s) => {
    const l = answerOnQuestion(s);
    s.listeners.add(l);
    return [s, l];
  });
  let r = await broadcastLatency(
    students,
    () => send(teacher, { type: 'teacher.quiz.start' }),
    (m) => m.type === 'quiz.changed' && m.quiz?.phase === 'question',
  );
  quiz.push(...r.latencies);
  missed += r.missed;
  // The teacher's own view of the quiz: once everybody has answered, the server shows the right
  // answer by itself, so "next" moves on from wherever the quiz really is.
  let phase = 'question';
  let qIndex = 0;
  const follow = (m) => {
    if (m.type === 'quiz.changed' && m.quiz) {
      phase = m.quiz.phase;
      qIndex = m.quiz.questionIndex;
    }
  };
  teacher.listeners.add(follow);
  await sleep(2500);
  for (let step = 0; step < 6 && phase !== 'podium'; step += 1) {
    const from = `${qIndex}:${phase}`;
    r = await broadcastLatency(
      students,
      () => send(teacher, { type: 'teacher.quiz.next' }),
      (m) =>
        m.type === 'quiz.changed' && !!m.quiz && `${m.quiz.questionIndex}:${m.quiz.phase}` !== from,
    );
    quiz.push(...r.latencies);
    missed += r.missed;
    await sleep(phase === 'question' ? 2500 : 300);
  }
  teacher.listeners.delete(follow);
  send(teacher, { type: 'teacher.quiz.finish' });
  for (const [s, l] of answerers) s.listeners.delete(l);
  report.quizMs = { ...stats(quiz), missed, answersSent: answers };

  // 4. Thumbnails from all 30 while slides keep changing.
  const thumb = Buffer.alloc(30 * 1024, 0x41)
    .toString('base64')
    .slice(0, 40_000);
  const before = sample(pid);
  const teacherBytes = teacher.bytesIn;
  let thumbsSeen = 0;
  const countThumbs = (m) => {
    if (m.type === 'thumb') thumbsSeen += 1;
  };
  teacher.listeners.add(countThumbs);
  const timers = students.map((s, i) =>
    setTimeout(
      () => {
        send(s, { type: 'student.thumb', jpeg: thumb });
        s.thumbTimer = setInterval(() => send(s, { type: 'student.thumb', jpeg: thumb }), 3000);
      },
      (i * 3000) / students.length,
    ),
  );
  const underLoad = [];
  missed = 0;
  const until = now() + THUMB_SECONDS * 1000;
  let i = 0;
  while (now() < until) {
    i += 1;
    r = await broadcastLatency(
      students,
      () => send(teacher, { type: 'teacher.screen.set', index: i % 10 }),
      (m) => m.type === 'screen.changed' && m.index === i % 10,
    );
    underLoad.push(...r.latencies);
    missed += r.missed;
    await sleep(900);
  }
  for (const t of timers) clearTimeout(t);
  for (const s of students) clearInterval(s.thumbTimer);
  teacher.listeners.delete(countThumbs);
  const after = sample(pid);
  report.thumbnails = {
    seconds: THUMB_SECONDS,
    received: thumbsSeen,
    expectedAbout: Math.round((students.length * THUMB_SECONDS) / 3),
    teacherKbPerSec: Math.round((teacher.bytesIn - teacherBytes) / 1024 / THUMB_SECONDS),
    slideMsMeanwhile: { ...stats(underLoad), missed },
    server: usage(before, after),
  };

  // 5. Thirty screenshots at once (the end of the practice).
  const jpeg = fakeJpeg(300 * 1024).toString('base64');
  t0 = now();
  const shots = await Promise.all(
    tokens.map((token) =>
      fetch(`${BASE}/api/sessions/${sessionId}/screenshots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-participant-token': token },
        body: JSON.stringify({ jpeg, width: 1366, height: 768, reason: 'stage_end' }),
      }).then((res) => res.status),
    ),
  );
  report.screenshots =
    shots[0] === 404
      ? {
          skipped:
            'server is not in CLASSROOM_MODE (only the teacher’s computer takes screenshots)',
        }
      : {
          allMs: Math.round(now() - t0),
          ok: shots.filter((s) => s === 200).length,
          statuses: [...new Set(shots)],
        };

  // 6. The end of the lesson.
  send(teacher, { type: 'teacher.session.end' });
  await sleep(500);
  for (const s of students) s.ws.close();
  teacher.ws.close();
  const end = sample(pid);
  report.server = pid
    ? { idleRssMb: idle?.rssMb ?? null, endRssMb: end?.rssMb ?? null }
    : { note: 'set SERVER_PID, or watch node.exe in the Task Manager while this runs' };
  report.finishedAt = new Date().toISOString();

  // ---------- the report
  const goal = (ms) => (ms === null ? '—' : ms < 300 ? `${ms} мс ✅` : `${ms} мс ❌`);
  console.log('');
  console.log(`Вход ${STUDENTS} учеников разом: ${report.loginAllMs} мс`);
  console.log(
    `Слайд у всех: p50 ${report.slideMs.p50} мс, p95 ${goal(report.slideMs.p95)}, максимум ${report.slideMs.max} мс, не дошло ${report.slideMs.missed}`,
  );
  console.log(
    `Викторина у всех: p50 ${report.quizMs.p50} мс, p95 ${goal(report.quizMs.p95)}, максимум ${report.quizMs.max} мс, не дошло ${report.quizMs.missed}, ответов ${report.quizMs.answersSent}`,
  );
  const th = report.thumbnails;
  console.log(
    `Миниатюры ${th.seconds} с: учитель получил ${th.received} (около ${th.expectedAbout}), ${th.teacherKbPerSec} КБ/с; слайд в это время p95 ${goal(th.slideMsMeanwhile.p95)}`,
  );
  if (th.server) {
    console.log(
      `  сервер: процессор ${th.server.cpuPercentOfOneCore} % одного ядра, память ${th.server.rssMb} МБ`,
    );
  }
  console.log(
    report.screenshots.skipped
      ? `Скриншоты: пропущено — ${report.screenshots.skipped}`
      : `Скриншоты: ${report.screenshots.ok} из ${STUDENTS} за ${report.screenshots.allMs} мс`,
  );
  if (report.server.idleRssMb) {
    console.log(
      `Память сервера: до урока ${report.server.idleRssMb} МБ, после ${report.server.endRssMb} МБ`,
    );
  }
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `report-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nОтчёт: ${file}`);
  const bad =
    report.slideMs.p95 >= 300 ||
    report.quizMs.p95 >= 300 ||
    report.slideMs.missed + report.quizMs.missed > 0 ||
    (report.screenshots.ok !== undefined && report.screenshots.ok < STUDENTS);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
