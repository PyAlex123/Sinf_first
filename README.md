# Sinf

Платформа для уроков информатики в школах Узбекистана (рабочее название). Что строим — в [`CLAUDE.md`](CLAUDE.md), текущий план — [`STAGE1.md`](STAGE1.md) (этап 1, демонстрационный веб-MVP), дальнейший — [`PLAN.md`](PLAN.md).

## Что нужно для запуска

- **Node.js 22 LTS** (22.12 или новее) — https://nodejs.org
- **pnpm 10.** Проще всего включить через corepack, который идёт вместе с Node.js:

  ```bash
  corepack enable
  ```

  corepack сам возьмёт версию pnpm из поля `packageManager` в `package.json`.

Docker, PostgreSQL и другие сервисы на этапе 1 не нужны (ADR-004).

## Как запустить

Установка (один раз):

```bash
pnpm install
```
```bash
cp .env.example .env
```

В `.env` задайте свой `DEMO_TEACHER_PASSWORD` и длинный случайный `SESSION_SECRET`.

### а) Ноутбук учителя в локальной сети школы — без интернета

```bash
pnpm build
```
```bash
pnpm start
```

Всё работает одним процессом на порту 3000: API, WebSocket и веб. Узнайте адрес ноутбука в сети
кабинета (Windows: `ipconfig`, строка «IPv4-адрес»). Ученики открывают `http://192.168.x.x:3000`
на своих устройствах в той же сети. Учитель входит как `demo@sinf.local` с паролем из `.env`.

Здесь не работают только функции экрана: для них браузеру нужен HTTPS (шаг S1.14 отложен).
Брандмауэр, проверка с телефона и Windows-приложение без установки Node — в
[`docs/deploy.md`](docs/deploy.md).

### б) Хостинг с доменом и HTTPS

Нужен сервер Linux с Docker и домен, указывающий на него:

```bash
export SINF_DOMAIN=lesson.example.uz
```
```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Caddy сам получит сертификат и пропустит WebSocket. Дети открывают `https://lesson.example.uz`.
Вариант без Docker (systemd + Caddy), обновление и резервная копия — в
[`docs/deploy.md`](docs/deploy.md).

### Показ

Сценарий на 10 минут и чек-лист перед показом: [`docs/demo-script.md`](docs/demo-script.md).

> Как ученик входит в урок: код урока с проектора (или QR), затем своё имя в списке, затем две
> картинки со своей карточки (с 3-го класса — 4 цифры). Карточки печатаются со страницы класса.
> Виртуальные ученики для показа в одиночку и сброс демо — на странице «Демо» у демо-учителя.

Для разработки вместо сборки — `pnpm dev`: веб на http://localhost:5173, сервер на :3000.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm install` | установить зависимости всех пакетов |
| `pnpm dev` | сервер и веб в режиме разработки, параллельно |
| `pnpm build` | собрать все пакеты (`dist/`) |
| `pnpm start` | запустить собранный сервер |
| `pnpm test` | тесты (Vitest) всех пакетов |
| `pnpm lint` | ESLint и проверка форматирования Prettier |
| `pnpm format` | отформатировать код Prettier |
| `pnpm typecheck` | проверка типов TypeScript во всех пакетах |
| `pnpm seed` | демо-данные в пустую базу; `pnpm seed --reset` — стереть **всю** базу и засеять заново (только на своей машине; для показа — «Сбросить демо» на странице «Демо») |
| `pnpm import:html <файл детей> <файл учителя> <папка вывода>` | импорт уроков из HTML автора в `content/` (см. CLAUDE.md §10) |

## Структура

```
apps/server         Node.js + TypeScript: API, WebSocket, раздача веба (один процесс)
apps/web            веб-клиент: Svelte 5 + Vite, проигрыватель уроков, страницы учителя и ученика
deploy/             Dockerfile, docker-compose с Caddy (HTTPS) для сервера с доменом
packages/shared     общие zod-схемы и типы
packages/checkers   проверщики файлов практики (на этапе 1 почти пустой)
docs/decisions      архитектурные решения (ADR)
content-src/        исходные HTML-файлы уроков автора (не изменяются)
content/            импортированный контент уроков (`pnpm import:html`, ADR-005)
data/               локальная база и файлы (не в git)
```
