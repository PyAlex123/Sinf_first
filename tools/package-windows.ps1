<#
.SYNOPSIS
  Builds the portable Windows package of Sinf.

.DESCRIPTION
  Collects into one folder: our window (Sinf.exe), the Node runtime, the built server with its
  production dependencies, the built web client and the lessons. The result runs from any folder,
  including a flash drive, and needs no administrator rights (ADR-008).

  Run from the repository root AFTER `pnpm build` and `dotnet publish apps/desktop`. The server is
  deployed by this script itself, straight into the package: copying a pnpm node_modules tree with
  Copy-Item breaks the links between packages, and the server then cannot find its dependencies.

.PARAMETER Out
  Folder the package is written to; it is replaced.

.PARAMETER DesktopPublish
  Folder `dotnet publish` wrote Sinf.exe to.

.PARAMETER NodeVersion
  Node version downloaded from nodejs.org for the package. It must be new enough for the prebuilt
  better-sqlite3 binary: 22.12 crashes on load (0xC0000005), 22.23.4 works. CI passes its own version,
  the one the smoke test then runs against.
#>
[CmdletBinding()]
param(
    [string]$Out = 'out/Sinf',
    [string]$DesktopPublish = 'apps/desktop/bin/Release/net10.0-windows/win-x64/publish',
    [string]$NodeVersion = '22.23.4'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Copy-Tree([string]$From, [string]$To) {
    if (-not (Test-Path $From)) { throw "Не найдено: $From" }
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    Copy-Item -Path (Join-Path $From '*') -Destination $To -Recurse -Force
}

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

Write-Host '1/5 our window'
Copy-Tree $DesktopPublish $Out
Copy-Item 'apps/desktop/sinf.ico' (Join-Path $Out 'sinf.ico') -Force

Write-Host '2/5 server with production dependencies'
# pnpm writes straight into the package: the folder must not exist yet, and nothing is copied afterwards.
# `server/drizzle` holds the SQL migrations the server runs at startup and comes along through "files".
pnpm --filter @sinf/server deploy --legacy --prod (Join-Path $Out 'server')
if ($LASTEXITCODE -ne 0) { throw 'pnpm deploy не справился' }

Write-Host "3/5 Node $NodeVersion"
$nodeZip = Join-Path ([System.IO.Path]::GetTempPath()) "node-v$NodeVersion-win-x64.zip"
$nodeDir = Join-Path ([System.IO.Path]::GetTempPath()) "node-v$NodeVersion-win-x64"
if (-not (Test-Path $nodeZip)) {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $nodeZip
}
if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
Expand-Archive -Path $nodeZip -DestinationPath ([System.IO.Path]::GetTempPath()) -Force
Copy-Item (Join-Path $nodeDir 'node.exe') (Join-Path $Out 'server/node.exe') -Force

Write-Host '4/5 web client and lessons'
Copy-Tree 'apps/web/dist' (Join-Path $Out 'web')
Copy-Tree 'content' (Join-Path $Out 'content')

Write-Host '5/5 readme'
$readme = @'
Sinf — урок информатики

Один и тот же архив — для компьютера учителя и для компьютеров учеников.

Как запустить
  1. Распакуйте эту папку целиком (запуск прямо из архива не работает).
  2. Откройте Sinf.exe. При первом запуске Sinf спросит, что это за компьютер:
     «Компьютер учителя» или «Компьютер ученика» (и его имя в кабинете, например ПК-05).
     Сменить потом: Sinf.exe --setup

Компьютер учителя
  - Окно Sinf с панелью учителя; в синей полосе сверху — адрес урока и пароль учителя.
  - Логин учителя: demo@sinf.local, пароль показан в окне (свой на каждом компьютере).
  - При первом запуске Sinf попросит «Пароль учеников»: им администратор выходит из Sinf
    на компьютерах учеников. Сменить — кнопка «Пароль учеников».
  - Windows спросит про доступ к сети дважды (node.exe и Sinf.exe) — оба раза «Разрешить».

Компьютер ученика
  - Окно на весь экран, само находит компьютер учителя в сети и открывает урок.
    Если не находит — «Ввести адрес вручную» (адрес из синей полосы у учителя).
  - Запускается сам при входе в Windows.
  - Запоминает компьютер учителя, который нашёл первым (по ключу: восемь знаков вроде
    3F9A-01C7 видны и в синей полосе учителя, и в окне ученика). Чужой «учитель» в той же
    сети ему не указ. Новый учитель — Ctrl+Alt+Shift+F12, пароль, «Сменить настройки».
  - Из окна не выйти клавишами Win, Alt+Tab, Alt+F4. Выход для администратора:
    Ctrl+Alt+Shift+F12 и пароль учеников.
  - Пока открыты Ctrl+Alt+Del и Win+L: их закроет служба Windows (следующий этап).

Ученики без программы
  На любом устройстве в той же сети открывают адрес из синей полосы, вводят код урока,
  выбирают своё имя и нажимают свои картинки.

Где лежат данные
  %LOCALAPPDATA%\Sinf — база данных (у учителя), настройки, журнал работы.
  teacher.key там же у учителя — ключ этого компьютера. Не удаляйте его: без него
  компьютеры учеников перестанут узнавать учителя, и каждый придётся настроить заново.
  Саму папку программы можно носить на флешке.

Полный сценарий проверки на 2–3 компьютерах — docs/hardware-test.md в репозитории.
'@
Set-Content -Path (Join-Path $Out 'Прочти меня.txt') -Value $readme -Encoding UTF8

$size = (Get-ChildItem $Out -Recurse -File | Measure-Object -Property Length -Sum).Sum
$files = (Get-ChildItem $Out -Recurse -File | Measure-Object).Count
Write-Host ''
Write-Host ("Готово: {0} файлов, {1:N1} МБ -> {2}" -f $files, ($size / 1MB), $Out)
Get-ChildItem $Out | Select-Object Name, @{ Name = 'МБ'; Expression = {
    if ($_.PSIsContainer) {
        '{0:N1}' -f ((Get-ChildItem $_.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB)
    } else {
        '{0:N1}' -f ($_.Length / 1MB)
    }
} } | Format-Table -AutoSize
