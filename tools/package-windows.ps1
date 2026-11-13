<#
.SYNOPSIS
  Builds the portable Windows package of Sinf.

.DESCRIPTION
  Collects into one folder: our window (Sinf.exe), the Node runtime, the built server with its
  production dependencies, the built web client and the lessons. The result runs from any folder,
  including a flash drive, and needs no administrator rights (ADR-008).

  Run from the repository root AFTER `pnpm build`, `pnpm --filter @sinf/server deploy --legacy --prod out/server`
  and `dotnet publish apps/desktop`. The CI workflow .github/workflows/windows-app.yml does exactly that.

.PARAMETER Out
  Folder the package is written to; it is replaced.

.PARAMETER DesktopPublish
  Folder `dotnet publish` wrote Sinf.exe to.

.PARAMETER NodeVersion
  Node version downloaded from nodejs.org for the package.
#>
[CmdletBinding()]
param(
    [string]$Out = 'out/Sinf',
    [string]$DesktopPublish = 'apps/desktop/bin/Release/net10.0-windows/win-x64/publish',
    [string]$ServerDeploy = 'out/server',
    [string]$NodeVersion = '22.12.0'
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

Write-Host "2/5 Node $NodeVersion"
$nodeZip = Join-Path ([System.IO.Path]::GetTempPath()) "node-v$NodeVersion-win-x64.zip"
$nodeDir = Join-Path ([System.IO.Path]::GetTempPath()) "node-v$NodeVersion-win-x64"
if (-not (Test-Path $nodeZip)) {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $nodeZip
}
if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
Expand-Archive -Path $nodeZip -DestinationPath ([System.IO.Path]::GetTempPath()) -Force
New-Item -ItemType Directory -Force -Path (Join-Path $Out 'server') | Out-Null
Copy-Item (Join-Path $nodeDir 'node.exe') (Join-Path $Out 'server/node.exe') -Force

Write-Host '3/5 server'
# `server/drizzle` holds the SQL migrations the server runs at startup: it must stay.
Copy-Tree $ServerDeploy (Join-Path $Out 'server')

Write-Host '4/5 web client and lessons'
Copy-Tree 'apps/web/dist' (Join-Path $Out 'web')
Copy-Tree 'content' (Join-Path $Out 'content')

Write-Host '5/5 readme'
$readme = @'
Sinf — урок информатики

Как запустить
  1. Распакуйте эту папку целиком (запуск прямо из архива не работает).
  2. Откройте Sinf.exe. Откроется окно Sinf — это и есть программа,
     никакой браузер не запускается.
  3. В синей полосе сверху написан адрес для учеников и пароль учителя.

Вход учителя
  Логин: demo@sinf.local
  Пароль: показан в окне программы (он свой на каждом компьютере).

Ученики
  На своём устройстве в той же сети открывают адрес из синей полосы,
  нажимают «Я ученик» и выбирают класс. Если адрес не открывается,
  разрешите Sinf доступ к сети в брандмауэре Windows (запрос появляется
  при первом запуске) и проверьте, что устройства в одной сети Wi-Fi.

Где лежат данные
  %LOCALAPPDATA%\Sinf — база данных, журнал работы, настройки.
  Саму папку программы можно носить на флешке.

Чего здесь пока нет
  Киоска, блокировки «Внимание», трансляции экрана и проверки файлов
  практики. Это отдельный этап работы.
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
