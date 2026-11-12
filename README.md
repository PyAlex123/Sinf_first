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

```bash
pnpm install
cp .env.example .env
pnpm dev
```

> После `pnpm dev` откройте http://localhost:5173 (в режиме разработки веб отдаёт Vite, сервер работает на :3000). Для урока в классе — `pnpm build && pnpm start` и адрес ноутбука в локальной сети, подробно в [`docs/deploy.md`](docs/deploy.md) (там же вариант с облачным сервером и доменом).
>
> Демо-учитель: `demo@sinf.local`, пароль — `DEMO_TEACHER_PASSWORD` из `.env`. База SQLite создаётся в `data/` и при первом запуске заполняется демо-данными. Ученики нажимают «Я ученик» и выбирают класс; имён и кодов пока нет (ADR-007).

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
| `pnpm seed` | демо-данные в пустую базу; `pnpm seed --reset` — стереть и засеять заново |
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
