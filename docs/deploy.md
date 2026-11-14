# Запуск для урока: локальная сеть и облачный сервер

Два способа показать урок классу. В обоих случаях работает один и тот же процесс Node: API, WebSocket и собранный веб-клиент на одном порту (ADR-004).

| | Ноутбук учителя в локальной сети | Облачный сервер с доменом |
|---|---|---|
| Адрес для детей | `http://192.168.x.x:3000` | `https://ваш-домен` |
| Интернет | не нужен | нужен |
| Функции экрана (S1.14) | нет (нужен HTTPS) | да |
| Что ставить | Node.js 22, pnpm | Docker + Docker Compose |

Вход учителя в обоих случаях: `demo@sinf.local`, пароль — `DEMO_TEACHER_PASSWORD` из `.env`. Ученики открывают адрес, нажимают «Я ученик» и выбирают класс.

---

## 1. Ноутбук учителя в локальной сети школы

Один раз:

```bash
corepack enable
```
```bash
pnpm install
```
```bash
cp .env.example .env
```

В `.env` задайте свой пароль учителя (`DEMO_TEACHER_PASSWORD`) и любой длинный `SESSION_SECRET`. `HOST=0.0.0.0` уже стоит — сервер слушает все сетевые интерфейсы.

Сборка и запуск:

```bash
pnpm build
```
```bash
pnpm start
```

Узнайте адрес ноутбука в сети кабинета: в Windows — `ipconfig` (строка «IPv4-адрес», например `192.168.1.15`). Дети открывают `http://192.168.1.15:3000`.

**Брандмауэр Windows.** При первом запуске Windows спросит, разрешить ли Node.js доступ к сети — ответьте «Разрешить» для частных сетей. Если окна не было и дети не могут открыть адрес, выполните в PowerShell от администратора:

```powershell
netsh advfirewall firewall add rule name="Sinf" dir=in action=allow protocol=TCP localport=3000
```

Ноутбук и ПК учеников должны быть в одной сети (один Wi-Fi или один свитч). Проверка: откройте тот же адрес на телефоне в этой сети.

Для разработки вместо `pnpm build && pnpm start` можно запускать `pnpm dev`: веб тогда на `http://localhost:5173`, сервер на `:3000`, и Vite проксирует запросы.

---

## 2. Облачный сервер с доменом (Docker + Caddy)

Нужен сервер Linux с Docker и Docker Compose и домен, A-запись которого указывает на IP сервера. Порты 80 и 443 должны быть открыты. Caddy сам получает и продлевает сертификат Let's Encrypt.

На сервере:

```bash
git clone <адрес репозитория> sinf && cd sinf
```
```bash
cp .env.example .env
```

В `.env` задайте `DEMO_TEACHER_PASSWORD` и случайный `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Запуск:

```bash
export SINF_DOMAIN=lesson.example.uz
```
```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Через минуту откройте `https://lesson.example.uz/health` — должно быть `{"status":"ok"}`. Логи: `docker compose -f deploy/docker-compose.yml logs -f app`.

Без домена (например, по IP, временно): не задавайте `SINF_DOMAIN` — Caddy отдаст сайт по HTTP на порту 80. Функции экрана при этом не работают.

**Обновление:**

```bash
git pull && docker compose -f deploy/docker-compose.yml up -d --build
```

База и файлы живут в томе `sinf-data` и при обновлении сохраняются. Сброс демо-данных: кнопка в будущем интерфейсе (S1.15) или `POST /api/demo/reset` под cookie учителя; полный сброс — `docker compose -f deploy/docker-compose.yml down -v`.

**Резервная копия базы:**

```bash
docker compose -f deploy/docker-compose.yml exec app sh -c 'cat /data/sinf.db' > sinf-backup.db
```

### Без Docker (systemd + Caddy)

Если Docker ставить не хочется: поставьте Node.js 22 и pnpm, соберите как в варианте 1 (`pnpm install`, `.env`, `pnpm build`), затем:

1. Служба systemd `/etc/systemd/system/sinf.service`:

```ini
[Unit]
Description=Sinf lesson server
After=network.target

[Service]
WorkingDirectory=/opt/sinf
EnvironmentFile=/opt/sinf/.env
Environment=NODE_ENV=production HOST=127.0.0.1
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always
User=sinf

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sinf
```

2. Caddy (`/etc/caddy/Caddyfile`):

```
lesson.example.uz {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

---

## 3. Windows-приложение (своё окно, без браузера)

Портативный архив: своё окно Sinf с панелью учителя внутри (WebView2), Node и сервер в комплекте. Киоска и блокировок здесь пока нет — ADR-008.

**Где взять.** GitHub → вкладка **Actions** → workflow **Windows app** → последний зелёный запуск → внизу **Artifacts** → `Sinf-windows-x64`. Если запуска нет, нажать **Run workflow** на своей ветке.

**Как запустить.**

1. Распаковать архив целиком (из самого архива не запускается).
2. Открыть `Sinf.exe`. Откроется окно Sinf; браузер не запускается.
3. Windows спросит про доступ к сети — разрешить для частной сети, иначе ученики не подключатся.
4. В синей полосе сверху: адрес для учеников, логин `demo@sinf.local` и пароль (генерируется на каждом компьютере свой).

**Ученики.** На своём устройстве в той же сети открывают адрес из полосы → «Я ученик» → класс.

**Где данные.** `%LOCALAPPDATA%\Sinf`: база `sinf.db`, настройки `config.json`, журнал `logs\server.log`. Папку программы можно носить на флешке. Сброс демо — удалить `sinf.db` при закрытой программе.

**Если не запускается.**

- «Папка программы неполная» — архив распакован не целиком.
- Просит WebView2 Runtime — согласиться на установку (или поставить Microsoft Edge WebView2 Runtime вручную).
- «Сервер не ответил» — посмотреть `%LOCALAPPDATA%\Sinf\logs\server.log`.

**Собрать самому** (нужен Windows, Node 22, .NET 10 SDK):

```powershell
pnpm install
pnpm build
dotnet publish apps/desktop/Sinf.Desktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
./tools/package-windows.ps1
```

---

## 4. Перед уроком

- Запустить сервер и открыть адрес на своём экране: `/health` отвечает, главная открывается.
- Войти как учитель, при необходимости сбросить демо (`pnpm seed --reset` на ноутбуке).
- Открыть `/present/<id>` на проекторе после «Начать урок» (ссылка «Проектор» в панели).
- Проверить с одного ПК ученика: «Я ученик» → класс → «Начать» → экран следует за учителем.
- На слабых ПК включить полный экран (кнопка «Начать» делает это сама).
