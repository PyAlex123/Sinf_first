# Технический план этапа 1 (шаги S1.3–S1.16)

> Как устроено то, что мы строим в `STAGE1.md`: сервер, база, протокол реального времени, движок сценария, веб-клиент. Шаги S1.1 (каркас) и S1.2 (импорт уроков, ADR-005) уже сделаны. Этот документ — ориентир для следующих шагов; если шаг требует отступить от него, это записывается в ADR.

---

## 0. Принципы

- **Сервер — источник истины о сеансе урока.** Клиенты (учитель, ученик, проектор) только рисуют присланное состояние и отправляют команды.
- **Один процесс Node** (ADR-004): Fastify раздаёт API, статику веба и `content/`, WebSocket висит на том же порту.
- **Чистая логика отдельно от ввода-вывода.** Движок сценария, подсчёт очков викторины, проверка кодов — функции без побочных эффектов в `packages/shared`. Их покрываем тестами и используем и на сервере, и в вебе.
- **Без тяжёлых зависимостей.** Начальный JS веба ≤ 200 КБ gzip (CLAUDE.md §3.1). Контент урока грузится отдельно по `/content/…` и в бюджет не входит.
- **Слабые устройства у детей.** Экраны ученика от 360 px, крупные кнопки, минимум текста, озвучка.

---

## 1. Зависимости

Добавляются по мере шагов, каждая с причиной.

| Пакет | Зачем | Шаг |
|---|---|---|
| `fastify`, `@fastify/static`, `@fastify/cookie` | сервер, статика, cookie учителя | S1.3 |
| `better-sqlite3`, `drizzle-orm`, `drizzle-kit` | база и миграции (в `pnpm-workspace.yaml` добавить `better-sqlite3` в `onlyBuiltDependencies`) | S1.3 |
| `pino-pretty` (dev) | читаемые логи в разработке | S1.3 |
| `svelte@5`, `vite`, `@sveltejs/vite-plugin-svelte` | веб-клиент | S1.4 |
| `@fastify/websocket` | WebSocket | S1.7 |
| QR-код: `qrcode-generator` (≈ 10 КБ) или своя реализация — решить при S1.7 | QR на проекторе и карточках | S1.7 |
| `fflate` | zip для xlsx (лист OOXML пишем сами, exceljs не берём) | S1.13 |

Без зависимостей: хэш паролей и кодов — `scrypt` из `node:crypto`; роутер и i18n — свои (около 100 строк каждый); идентификаторы — `crypto.randomUUID()`.

---

## 2. Сервер `apps/server/src`

```
index.ts              старт: config → db (migrate, seed если пусто) → content → listen
config.ts             zod-схема env: PORT, HOST, DATA_DIR, DATABASE_PATH, DEMO_TEACHER_PASSWORD,
                      SESSION_SECRET, LOG_LEVEL
app.ts                buildApp(): плагины, маршруты, статика (/content, /assets, SPA fallback)
db/schema.ts          схема Drizzle (§3)
db/index.ts           подключение; db/migrate.ts — миграции из drizzle/
db/seed.ts            демо-данные из STAGE1 §5, детерминированные (фиксированные имена и коды)
content/              загрузка content/<course>/{course,lessons/*,quizzes/*}.json в память при старте,
                      проверка схемами из @sinf/shared
auth/                 учитель: подписанная httpOnly-cookie (SameSite=Lax);
                      ученик: токен сеанса (32 случайных байта), хранится в sessionStorage
routes/               auth, classes, lessons, sessions, join, journal, export, demo, screenshots
realtime/             ws.ts (комнаты сеансов), session-store.ts (состояние в памяти + сохранение в SQLite),
                      engine-runner.ts (таймеры движка), handlers/{teacher,student}.ts
services/             quiz-scoring, grading (звёзды → 2–5), attendance, xlsx, virtual-students
cli/                  seed.ts, import-html.ts (готов)
import/               импорт уроков (готов, S1.2)
```

- Состояние **активного** сеанса живёт в памяти: `Map<sessionId, SessionState>`. Оно сохраняется в `sessions.stateJson` при каждом переходе этапа и не чаще раза в 5 с при прочих изменениях. После перезапуска сервера сеанс восстанавливается **на паузе**: учитель видит, что произошло, и нажимает «Продолжить».
- Результаты (звёзды за экран, ответы викторины, посещаемость, события) пишутся в таблицы сразу, а не из снимка состояния.
- Файлы (скриншоты) — в `DATA_DIR/screenshots/<sessionId>/…`.

---

## 3. Модель данных

SQLite через Drizzle. Схема переносимая: текстовые идентификаторы (`randomUUID`), даты — ISO-строки в UTC, JSON — в текстовых колонках. На PostgreSQL переезжаем сменой драйвера и миграций, без правки кода.

| Таблица | Поля | Примечание |
|---|---|---|
| `schools` | id, name | одна запись «Demo School» |
| `users` | id, role (`teacher`), email, passwordHash, fullName, locale | демо-учитель |
| `classes` | id, schoolId, name («1А»), grade, academicYear, settings (JSON: `starsToGrade`, `gradeThresholds`, `codePics`) | `codePics` — 6 ключей PICS для кодов класса |
| `students` | id, classId, firstName, lastName, codeKind (`pics` / `digits`), codeHash, codePublic, isVirtual, isActive, sortOrder | `codePublic` — код открытым текстом для печати карточек. Допустимо только на этапе 1: ученики вымышленные. В полной версии (PLAN.md 2.4) код показывается один раз и хранится только хэш |
| `sessions` | id, classId, lessonId (id из `content/`), teacherId, joinCode (4 цифры, уникален среди активных), status (`active` / `ended`), startedAt, endedAt, demoSpeed, stateJson | |
| `attendance` | sessionId, studentId, status (`present` / `absent`), joinedAt | PK (sessionId, studentId) |
| `activity_events` | id, sessionId, studentId?, type, at, data (JSON) | `join`, `leave`, `tab_hidden`, `fullscreen_exit`, `hand_raise`, `screen_done`, `lock`, `unlock`, `stage_change` |
| `screen_results` | sessionId, studentId, screenIndex, stars, attempts, firstAt, lastAt | PK (sessionId, studentId, screenIndex). Звёзды за тренажёр и «Напечатай слово» |
| `practice_marks` | sessionId, studentId, stars (1–3), screenshotId?, at | звёзды учителя за рисунок в Paint |
| `quiz_attempts` | id, sessionId, studentId, questionIndex, optionIndex, correct, timeMs, points | |
| `screenshots` | id, sessionId, studentId, kind (`auto` / `manual`), takenAt, fileKey, width, height | миниатюры в базу не пишем |
| `grades` | id, studentId, classId, sessionId, date, stars, value (2–5)?, source, comment | строка журнала, создаётся при завершении сеанса |

---

## 4. HTTP API

Префикс `/api`. Схемы запросов и ответов — zod в `packages/shared/src/api.ts`, сервер проверяет вход, веб использует типы.

| Метод | Путь | Кто | Что |
|---|---|---|---|
| GET | `/health` | все | `{ status: 'ok' }` |
| POST / DELETE | `/api/auth/teacher` | учитель | вход по email и паролю / выход |
| GET | `/api/me` | учитель | учитель и его класс |
| GET | `/api/courses` | учитель | список курсов и уроков (`course.json`) |
| GET | `/api/lessons/:id` | все | урок из `content/` (сценарий учителя — отдельный файл, только учителю) |
| GET | `/api/classes/:id` | учитель | ученики и настройки класса |
| POST | `/api/students/:id/code` | учитель | перевыпуск кода |
| POST | `/api/sessions` | учитель | создать сеанс: classId, lessonId, demoSpeed |
| GET | `/api/sessions/:id` | учитель | снимок состояния |
| GET | `/api/sessions/:id/results` | учитель | итоги сеанса (§12) |
| POST | `/api/join/lookup` | ученик | joinCode → класс, список имён, вид кода, картинки класса |
| POST | `/api/join` | ученик | studentId + код → токен ученика |
| GET | `/api/journal/:classId` | учитель | журнал класса |
| GET | `/api/journal/:classId/export.xlsx` | учитель | выгрузка в Excel |
| POST | `/api/demo/reset` | учитель | сброс демо-данных |
| POST | `/api/demo/virtual` | учитель | добавить N виртуальных учеников в сеанс |
| POST | `/api/sessions/:id/screenshots` | ученик (токен) | загрузка JPEG (S1.14) |

Статика: `/content/*` из `content/` (кэш на год: имена файлов в `media/` — хэши), `/assets/*` из `apps/web/dist`, остальное — `index.html` (SPA).

---

## 5. Протокол реального времени

Подробно — ADR-006. Схемы: `packages/shared/src/protocol.ts`.

- Один endpoint `/ws`. Роль определяется по токену: `teacher` (cookie), `student` (токен из `/api/join`), `projector` (токен сеанса из ссылки проектора).
- Все сообщения — JSON `{ v: 1, type, ...payload }`, zod discriminated union. Неизвестный тип логируется и игнорируется.
- При подключении сервер шлёт `state.snapshot`: полное состояние (§6) и `serverNow`. Дальше только дельты. Клиент хранит `offset = serverNow − Date.now()` и рисует все таймеры по серверному времени.
- Переподключение с тем же токеном продолжает сеанс. Второе устройство того же ученика вытесняет первое: ему уходит `session.kicked`.
- Heartbeat ping/pong каждые 15 с; нет pong 30 с — ученик помечается оффлайн.
- Миниатюры экранов (S1.14) идут бинарными кадрами в том же соединении.

**Клиент → сервер**

| Учитель | Ученик |
|---|---|
| `teacher.stage.set {index}`, `teacher.stage.pause`, `teacher.stage.resume`, `teacher.stage.extend {minutes}`, `teacher.stage.skip`, `teacher.stage.back` | `student.screen.set {index}` |
| `teacher.mode.set {mode}` (`presentation` / `free`), `teacher.screen.set {index}` | `student.screen.done {index, stars}` |
| `teacher.lock {targets, text?}`, `teacher.unlock {targets}` — `targets: 'all' \| studentId[]` | `student.step.done {index}` |
| `teacher.practice.mark {studentId, stars}` | `student.hand {up}` |
| `teacher.quiz.start`, `teacher.quiz.next`, `teacher.quiz.reveal`, `teacher.quiz.finish` | `student.visibility {hidden, fullscreen}` |
| `teacher.thumbs {on}`, `teacher.screenshot.request {targets}` | `student.quiz.answer {questionIndex, optionIndex}` |
| `teacher.session.end` | `student.thumb` (бинарный кадр) |

**Сервер → клиенты**

Всем в комнате: `state.snapshot`, `stage.changed`, `stage.timer {startedAt, pausedAt, extraMs}`, `stage.countdown {until}`, `mode.changed`, `screen.changed`, `lock.changed`, `rest.changed {on}`, `quiz.question`, `quiz.reveal`, `quiz.leaderboard`, `quiz.podium`, `student.updated {studentId, presence}`, `session.ended`.
Адресно: `session.kicked`, `screenshot.request`, `thumb.update {studentId}` (учителю).

---

## 6. Состояние сеанса

```ts
interface SessionState {
  id: string; lessonId: string; classId: string;
  status: 'active' | 'ended';
  demoSpeed: 1 | 10;
  stage: {
    index: number;
    startedAt: number;       // серверное время, мс
    pausedAt?: number;
    extraMs: number;         // «+5 минут»
    countdownUntil?: number; // обратный отсчёт перед автопереходом
    part: 'work' | 'rest' | null; // отдых внутри практики
  };
  mode: 'presentation' | 'free' | 'quiz';
  screenIndex: number;       // текущий экран в режиме «Презентация»
  locks: { all: { text: string } | null; byStudent: Record<string, { text: string }> };
  quiz: {
    questionIndex: number; questionStartedAt: number;
    phase: 'question' | 'reveal' | 'leaderboard' | 'podium';
    answers: Record<string, { optionIndex: number; timeMs: number }>;
    scores: Record<string, number>;
  } | null;
  thumbsOn: boolean;
  students: Record<string, {
    online: boolean; isVirtual: boolean;
    screenIndex: number; stepIndex: number | null; stars: number;
    hand: boolean; hidden: boolean; fullscreen: boolean;
    screenShare: 'off' | 'on' | 'unavailable';
    lastSeenAt: number;
  }>;
}
```

Движок — чистый модуль `packages/shared/src/session-engine.ts`:

- `reduce(state, event, now): { state, effects }` — применяет команду учителя, событие ученика или срабатывание таймера; `effects` — что разослать и что записать в базу;
- `nextTimerAt(state): number | null` — когда сервер должен снова вызвать `reduce` с событием `tick`.

Сервер только вызывает `reduce` и исполняет `effects`. Все переходы тестируются на reducer'е без сети и базы (S1.8).

---

## 7. Движок сценария (S1.8)

- Этапы и части практики берутся из `lesson.stages` (ADR-005). Учебное время этапа: `t = (now − startedAt − пауза + extraMs) × demoSpeed`.
- Автопереход: за 10 с учебного времени до конца этапа начинается обратный отсчёт (`stage.countdown`), по нулю — следующий этап. Кнопки учителя: «Пауза», «+5 мин» (`extraMs`), «Пропустить», «Назад».
- Внутри практики часть `rest` включает `rest.changed {on: true}`: у учеников экран «Отвернулись от экранов!» (ищем в уроке слайд с «Отдыхаем», иначе встроенный). Ввод не блокируется — это браузер.
- При смене этапа режим ставится по этапу: теория → `presentation`, практика → `free` (на кружке — `presentation` по шагам, учитель может переключить), викторина → `quiz`, итоги → экран итогов. `screenIndex` переходит на первый экран этапа.
- Викторина — отдельный этап после практики, если к уроку есть `quizzes/<id>.json`; её время берётся из рефлексии (STAGE1 §1: викторина входит в демо урока 10).
- Демо-скорость `demoSpeed = 10` (1 минута урока = 6 секунд) задаётся при создании сеанса.

---

## 8. Веб-клиент `apps/web/src`

```
main.ts, App.svelte            точка входа, роутер, общий layout
lib/router.ts                  свой роутер на History API, динамические импорты страниц
lib/i18n/                      index.ts (функция t(), store языка), ru.json, uz.json
lib/platform.ts                isDesktop = false (CLAUDE.md §5.5)
lib/api.ts                     типизированный fetch по схемам @sinf/shared
lib/ws.ts                      клиент WebSocket: reconnect с backoff, offset серверного времени
lib/stores/session.svelte.ts   состояние сеанса на runes, применение дельт
lib/ui/                        Button, Card, Modal, Tile, Timer, Toast, LangSwitch; токены в styles/tokens.css
player/                        LessonPlayer.svelte; screens/{Slide,Step,TypeWord,Game}.svelte;
                               games/{Story,Pick,Train,Nbr,Word,Groups}.svelte;
                               lib/{drag.ts, speech.ts, sounds.ts, keyboard.ts, pics.ts}
pages/                         Home, Join, Student, Present,
                               teacher/{Login, Dashboard, Lesson, Cards, Session, Results, Journal, Demo}
scripts/check-bundle.mjs       проверка бюджета после vite build
```

- **Контент урока.** `lesson.css` подключается `<link>` при входе в проигрыватель; `course.svgDefs` вставляется один раз в скрытый `<svg>`; слайды рисуются через `{@html screen.html}` (HTML очищен импортом); `pics.json` грузится один раз и кэшируется. Картинки экрана грузит браузер по `<image href="/content/…">` только когда экран показан; следующий экран предзагружается.
- **Тренажёр.** Логика автора переносится в TypeScript по типам уровней. Перетаскивание — Pointer Events (мышь и палец), плюс «клик по карточке → клик по слоту», как в оригинале. Победа → событие `screenDone(stars)` → `student.screen.done`.
- **Озвучка и звуки.** `speechSynthesis` ru-RU с кнопкой 🔊 на каждом задании; звуки через `AudioContext` как у автора.
- **Ученик.** Полный экран по кнопке «Начать»; `visibilitychange` и `fullscreenchange` → `student.visibility`. Оверлей «Внимание!» поверх всего при `lock`.
- **Код-сплиттинг.** `player/` и `pages/teacher/*` грузятся динамически. В начальный бандл входят роутер, i18n, Home и Join.
- **Бюджет.** `scripts/check-bundle.mjs` считает gzip JS начальной загрузки по манифесту Vite; больше 200 КБ — сборка падает.

---

## 9. Вход ученика и коды (S1.6–S1.7)

- Картинки класса (6 штук) фиксированы в настройках класса: `sun`, `ball`, `tree`, `apple`, `cat`, `star` (ключи PICS; при сиде проверяется, что они есть в `pics.json`).
- Код ученика — **две разные картинки, порядок важен** (30 комбинаций). Ребёнок нажимает их по очереди, выбранное показывается крупно, есть кнопка «Стереть».
- Защита от перебора: 5 неверных попыток → блокировка на 2 минуты для пары (сеанс, ученик). Учитель видит попытки на плитке и может сбросить блокировку.
- Карточки для печати: A4, 8 на лист; имя, две картинки, QR на `/join?code=XXXX` (QR ведёт на вход в сеанс, личный код в него не входит).
- Демо-рассадка: `localStorage['sinf.student.<classId>'] = studentId`. При следующем входе сразу предлагается это имя и кнопка «Это не я».
- Для классов с 3-го — код из 4 цифр, тот же маршрут с цифровой клавиатурой.

---

## 10. Викторина (S1.12)

- Файл `content/1-klass-2-chetvert/quizzes/g10.json` по схеме `QuizSchema` в `@sinf/shared`: вопрос, озвучка `say`, 3–4 варианта (картинка из PICS + цвет + буква), индекс верного, лимит времени (по умолчанию 20 с). Вопросы составляются по слайдам урока 10, автор проверяет.
- Очки: `points = correct ? round(500 + 500 × (1 − timeMs / limitMs)) : 0`, чистая функция с тестами. После вопроса — верный ответ и топ-5; в конце — пьедестал на три места.
- Ответы и очки — в `quiz_attempts`; сумма идёт в итоги сеанса.

---

## 11. Панель учителя, «Внимание!», практика в Paint (S1.10–S1.11)

- Плитка ученика: имя, онлайн, текущий экран или шаг, звёзды, рука, «ушёл со вкладки», замок, миниатюра экрана (если есть). Выделение нескольких плиток кликом с Ctrl или чекбоксами; действия применяются к выделенным.
- «Внимание!»: `teacher.lock` → у учеников оверлей на весь экран с текстом (по умолчанию «Смотрите на учителя»). В интерфейсе учителя пометка: в браузере блокировка мягкая, ввод не блокируется.
- Шаги Paint на кружке: в режиме `presentation` шаг листает учитель, в `free` — ученик. У ученика кнопки «Я сделал этот шаг» и «Помогите». Учитель ставит 1–3 ★ за рисунок прямо на плитке → `practice_marks`.

---

## 12. Итоги и журнал (S1.13)

- Итоги сеанса — одна таблица класса: присутствие, ★ тренажёр, ★ Paint, очки викторины, итого. Оценка 2–5 считается только если в классе включено `starsToGrade` (для 1А выключено).
- Журнал класса: ученики × даты сеансов, в ячейке звёзды или оценка и отметка присутствия.
- Выгрузка в Excel: `services/xlsx.ts` пишет минимальный OOXML (строки и числа, один лист) и собирает zip через `fflate`. Тест распаковывает файл и проверяет XML; открыть в Excel проверяет автор.

---

## 13. Экраны через браузер (S1.14, только HTTPS)

- Ученик нажимает «Показать экран учителю» → `getDisplayMedia` → `<video>` → canvas 320 px → JPEG → бинарный кадр в WebSocket. Кадры шлются раз в 3 с, только пока у учителя `thumbsOn` и только если кадр изменился (сравнение по хэшу уменьшенного кадра).
- Скриншот до 1920 px и 400 КБ: по `screenshot.request` и автоматически за N минут до конца практики → `POST /api/sessions/:id/screenshots` → галерея итогов.
- Нет разрешения, HTTPS или поддержки (телефоны) → на плитке «экран не передаётся».

---

## 14. Виртуальные ученики (S1.15)

- Живут **на сервере** (`services/virtual-students.ts`), а не в вкладках браузера: так один ноутбук показывает «живой» класс из 20 человек.
- Поведение: входят с задержками 2–20 с; идут по экранам этапа со случайной скоростью; получают звёзды на 60–90 % экранов; иногда «уходят со вкладки» и поднимают руку; в викторине отвечают с точностью около 70 % и задержкой 2–12 с.
- Проходят через те же обработчики, что и настоящие ученики (внутренний «виртуальный сокет»), поэтому панель учителя их не отличает, кроме значка «виртуальный». Удаляются при сбросе демо.

---

## 15. Сборка и запуск (S1.16)

- `pnpm build`: shared → checkers → web (`vite build` + проверка бюджета) → server. `pnpm start` поднимает всё на одном порту.
- Dockerfile: `node:22-alpine`, multi-stage, том для `data/`.
- README, два варианта запуска:
  - ноутбук учителя в локальной сети: `HOST=0.0.0.0`, адрес вида `http://192.168.x.x:3000`, без функций экрана;
  - хостинг с Node.js, WebSocket и HTTPS: reverse proxy с заголовками Upgrade.
- `docs/demo-script.md` — сценарий показа на 10 минут и чек-лист перед показом.

---

## 16. Порядок шагов и зависимости

```
S1.3 сервер и база
 └─ S1.4 веб-каркас ── S1.5 проигрыватель ── S1.6 вход учителя, карточки
                                              └─ S1.7 сеанс, WebSocket, вход ученика   ← протокол и SessionState вводятся целиком
                                                  └─ S1.8 движок ── S1.9 презентация и проектор ── S1.10 панель и «Внимание!»
                                                                                                    ├─ S1.11 Paint
                                                                                                    ├─ S1.12 викторина
                                                                                                    └─ S1.13 итоги и журнал
                                                                                                        ├─ S1.14 экраны (HTTPS)
                                                                                                        ├─ S1.15 виртуальные ученики
                                                                                                        └─ S1.16 сборка и сценарий показа
```

Схемы протокола и `SessionState` вводятся в S1.7 сразу целиком (с полями для викторины и миниатюр), чтобы следующие шаги их расширяли, а не ломали.

---

## 17. Тесты по шагам

| Шаг | Что покрываем |
|---|---|
| S1.3 | `/health`, сид, сброс демо, хэширование кодов, загрузка и проверка `content/` |
| S1.5 | чистая логика каждого из 6 типов уровней (проверка ответа, подсчёт звёзд, раскладка клавиш); компоненты — без jsdom, только если появится лёгкий способ |
| S1.7 | вход: коды, лимит попыток, второе устройство, переподключение |
| S1.8 | reducer движка: все переходы, пауза, +5 минут, отдых, автопереход, демо-скорость |
| S1.12 | подсчёт очков и рейтинг |
| S1.13 | xlsx: zip распаковывается, XML корректен |
| S1.16 | smoke: `pnpm build && pnpm start` → `/health` и главная отвечают |

---

## 18. Решения по умолчанию

Автор может поправить любое; принятые — в ADR.

| Вопрос | Решение |
|---|---|
| Код из картинок | две разные из 6, порядок важен; 5 попыток, блокировка 2 минуты |
| CI | не на этапе 1 (PLAN.md 1.5), добавим после демо |
| Excel | свой минимальный писатель OOXML на `fflate` |
| Состояние сеанса | в памяти, снимок в SQLite; после перезапуска сервера — пауза |
| Виртуальные ученики | на сервере |
| Демо-скорость | ×10 (1 минута = 6 секунд), выбор при создании сеанса |
| Хостинг с HTTPS | решить к S1.14; код от выбора не зависит |
