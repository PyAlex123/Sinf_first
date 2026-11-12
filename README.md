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

> Сейчас (шаг S1.1) это только каркас: сервер и веб — заглушки. Сервер с базой появится в S1.3, веб-интерфейс — в S1.4.

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
| `pnpm seed` | заполнить базу демо-данными (с шага S1.3) |
| `pnpm import:html <файл детей> <файл учителя> <папка вывода>` | импорт уроков из HTML автора (с шага S1.2) |

## Структура

```
apps/server         Node.js + TypeScript: API, WebSocket, раздача веба (один процесс)
apps/web            веб-клиент (Svelte 5 + Vite с шага S1.4)
packages/shared     общие zod-схемы и типы
packages/checkers   проверщики файлов практики (на этапе 1 почти пустой)
docs/decisions      архитектурные решения (ADR)
content-src/        исходные HTML-файлы уроков автора (не изменяются)
content/            импортированный контент уроков (с шага S1.2)
data/               локальная база и файлы (не в git)
```
