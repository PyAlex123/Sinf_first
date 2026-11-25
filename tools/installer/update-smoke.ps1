<#
.SYNOPSIS
  The whole way of an update on a CI runner (stage 6, B6; ADR-023): an older Sinf is installed, a
  newer signed one appears on the classroom server, the updater waits out a lesson and then
  installs it silently, keeping the computer's role.

.DESCRIPTION
  Run on a Windows runner (administrator) after the installers were built. A throwaway key pair is
  made here; the installed Sinf.Updater.exe is replaced by one built with that key (-TestUpdater),
  because the real one trusts only the project's key. The "older" install is simulated by lowering
  the version the installer recorded, so one build is enough.

    1. Sinf as a student computer (ПК-07); its recorded version lowered to 0.3.0.
    2. The update installer signed with the test key on the packaged lesson server (CLASSROOM_MODE).
    3. Sinf's mark says a child is in a lesson: the updater waits.
    4. The lesson is over: the updater downloads, checks and installs; the version is the new one,
       the computer is still ПК-07, a student's.
    5. Removal.

.PARAMETER Version
  The version CI built: the update installer is out/installer/Sinf-update-<Version>.exe.

.PARAMETER TestUpdater
  Sinf.Updater.exe built with the public key printed by tools/update-key.mjs into -KeyFile.

.PARAMETER KeyFile
  The output of tools/update-key.mjs: line 2 is the private key, line 5 the public one.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$TestUpdater,
    [Parameter(Mandatory)][string]$KeyFile
)

$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$app = Join-Path $env:ProgramFiles 'Sinf'
$uninstallKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{5E7C3B1A-9D2F-4C8E-A6B4-3F1D2E9C7A50}_is1'
$logs = Join-Path $root 'out/installer-logs'
$work = Join-Path $root 'out/update-smoke'
New-Item -ItemType Directory -Force -Path $logs, $work | Out-Null

function Expect([bool]$Ok, [string]$What) {
    if (-not $Ok) { throw "НЕ ТАК: $What" }
    Write-Host "  ok: $What"
}

function Installed { return (Get-ItemProperty -Path $uninstallKey -ErrorAction SilentlyContinue).DisplayVersion }

function Mark([bool]$InLesson) {
    $dir = Join-Path $env:LOCALAPPDATA 'Sinf'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $mark = @{
        at = (Get-Date).ToUniversalTime().ToString('o')
        role = 'student'
        inLesson = $InLesson
        serverUrl = 'http://127.0.0.1:3124'
        platformUrl = $null
    } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText((Join-Path $dir 'activity.json'), $mark)
}

function Updater {
    $out = & (Join-Path $app 'Sinf.Updater.exe') --now | Out-String
    Write-Host "  Sinf.Updater: $($out.Trim())"
    return $out
}

Write-Host '1. Старая версия на ПК ученика'
$setup = (Get-ChildItem 'out/installer/Sinf-setup-*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
$p = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/ROLE=student', '/PC=ПК-07', "/LOG=$(Join-Path $logs 'old.log')" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Установка: код $($p.ExitCode)" }
Copy-Item $TestUpdater (Join-Path $app 'Sinf.Updater.exe') -Force
Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '0.3.0'
Expect ((Installed) -eq '0.3.0') 'установлена «старая» версия 0.3.0'

Write-Host '2. Новая версия на сервере класса'
$keys = Get-Content $KeyFile -Encoding UTF8
$env:SINF_UPDATE_KEY = $keys[1].Trim()
$signed = Join-Path $work 'signed'
& node tools/sign-update.mjs (Join-Path $root "out/installer/Sinf-update-$Version.exe") $Version $signed
if ($LASTEXITCODE -ne 0) { throw 'подпись не получилась' }
Remove-Item Env:SINF_UPDATE_KEY
$data = Join-Path $work 'data'
$store = Join-Path $data "updates/$Version"
New-Item -ItemType Directory -Force -Path $store | Out-Null
Copy-Item (Join-Path $signed "Sinf-update-$Version.exe") $store
$manifest = Get-Content (Join-Path $signed 'update.json') -Raw | ConvertFrom-Json
$manifest | Add-Member -NotePropertyName storedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o'))
[System.IO.File]::WriteAllText((Join-Path $store 'update.json'), ($manifest | ConvertTo-Json))

$env:NODE_ENV = 'production'
$env:PORT = '3124'
$env:HOST = '127.0.0.1'
$env:CLASSROOM_MODE = '1'
$env:DATA_DIR = $data
$env:DATABASE_PATH = Join-Path $data 'sinf.db'
$env:CONTENT_DIR = Join-Path $root 'out/Sinf/content'
$env:WEB_DIR = Join-Path $root 'out/Sinf/web'
$env:SESSION_SECRET = 'update-smoke-secret-not-a-real-one'
$env:DEMO_TEACHER_PASSWORD = 'update-smoke'
$server = Start-Process -FilePath (Join-Path $root 'out/Sinf/server/node.exe') -ArgumentList (Join-Path $root 'out/Sinf/server/dist/index.js') `
    -WorkingDirectory $root -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $work 'server.out.log') -RedirectStandardError (Join-Path $work 'server.err.log')
try {
    $latest = $null
    foreach ($try in 1..40) {
        Start-Sleep -Milliseconds 500
        try { $latest = Invoke-RestMethod 'http://127.0.0.1:3124/api/updates/latest' -TimeoutSec 2; break } catch { }
    }
    Expect ($latest.update.version -eq $Version) "сервер класса раздаёт $Version"

    Write-Host '3. Идёт урок — ждём'
    Mark $true
    $out = Updater
    Expect ($out -match 'WaitForLesson') 'программа обновления ждёт конца урока'
    Start-Sleep -Seconds 5
    Expect ((Installed) -eq '0.3.0') 'во время урока ничего не ставится'

    Write-Host '4. Урок кончился — обновляемся'
    Mark $false
    $out = Updater
    Expect ($out -match 'Install') 'программа обновления решила ставить'
    foreach ($try in 1..120) {
        if ((Installed) -eq $Version) { break }
        Start-Sleep -Seconds 2
    }
    $log = Get-Content (Join-Path $app 'updates/updater.log') -Raw -ErrorAction SilentlyContinue
    Write-Host "--- updater.log`n$log"
    Expect ((Installed) -eq $Version) "установлена новая версия $Version"
    foreach ($try in 1..30) {
        if (-not (Test-Path (Join-Path $app 'updates/installing'))) { break }
        Start-Sleep -Seconds 1
    }
    $setupJson = Get-Content (Join-Path $app 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Expect ($setupJson.role -eq 'student' -and $setupJson.pc -eq 'ПК-07') "компьютер остался ПК-07 ученика: $($setupJson | ConvertTo-Json -Compress)"
    Expect ($log -match 'installer finished with code 0') 'установщик завершился без ошибок'
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    Remove-Item (Join-Path $env:LOCALAPPDATA 'Sinf/activity.json') -ErrorAction SilentlyContinue
}

Write-Host '5. Удаление'
Start-Process -FilePath (Join-Path $app 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
foreach ($try in 1..60) {
    if (-not (Test-Path (Join-Path $app 'Sinf.exe'))) { break }
    Start-Sleep -Seconds 1
}
Expect (-not (Test-Path (Join-Path $app 'Sinf.exe'))) 'программа удалена'
Write-Host 'Обновление в порядке.'
exit 0
