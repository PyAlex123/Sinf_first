<#
.SYNOPSIS
  Installs, reinstalls and removes Sinf silently and checks what each step left (stage 3, H17).

.DESCRIPTION
  Run on a Windows runner (administrator) after the installer was built. Fails on the first thing
  that is not as it should be:
    1. a student computer, silently: files, setup.json with the role and the name, no start with
       Windows unless asked (finding 5), then with /AUTOSTART=1 — for every user, and kept by an
       update; the firewall rule for Sinf.exe and none for the server;
    2. the same computer again as the teacher's: setup.json says teacher, no start with Windows, the
       server is let through the firewall too, and the installed server really starts
       (`Sinf.exe --selftest`, as the teacher's window starts it — pc-test.md 8.3);
    3. an update over it (no /ROLE, as the updater runs it, B6): still the teacher's computer, and
       the server still starts;
    4. removal: no program, no start with Windows, no firewall rules, no update tasks.

.PARAMETER Setup
  The installer to test; by default the newest one in out/installer.
#>
[CmdletBinding()]
param([string]$Setup)

$ErrorActionPreference = 'Stop'
if (-not $Setup) {
    $Setup = (Get-ChildItem 'out/installer/Sinf-setup-*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
}
if (-not $Setup -or -not (Test-Path $Setup)) { throw 'Установщик не найден' }
$app = Join-Path $env:ProgramFiles 'Sinf'
$runKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
$logs = Join-Path (Get-Location) 'out/installer-logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Install([string[]]$Extra, [string]$Log) {
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$(Join-Path $logs $Log)") + $Extra
    $p = Start-Process -FilePath $Setup -ArgumentList $arguments -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Установка: код $($p.ExitCode), журнал $Log" }
}

function Rule([string]$Name) {
    & netsh advfirewall firewall show rule name="$Name" | Out-Null
    return $LASTEXITCODE -eq 0
}

function Autostart {
    return (Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue).Sinf
}

function Task([string]$Name) {
    & schtasks /Query /TN $Name *> $null
    return $LASTEXITCODE -eq 0
}

function Expect([bool]$Ok, [string]$What) {
    if (-not $Ok) { throw "НЕ ТАК: $What" }
    Write-Host "  ok: $What"
}

# The installed program's own server, started the way the teacher's window starts it. The build folder
# can be fine while Program Files is not (pc-test.md 8.3): only this run shows it.
function SelfTest([string]$When) {
    $p = Start-Process -FilePath (Join-Path $app 'Sinf.exe') -ArgumentList '--selftest' -Wait -PassThru
    $logDir = Join-Path $env:LOCALAPPDATA 'Sinf\logs'
    $result = Join-Path $logDir 'selftest.log'
    if ($p.ExitCode -ne 0) {
        foreach ($file in @($result, (Join-Path $logDir 'server.log'))) {
            Write-Host "--- $file"
            if (Test-Path $file) { Get-Content $file -Raw -Encoding UTF8 } else { Write-Host '(файла нет)' }
        }
    }
    $said = if (Test-Path $result) { (Get-Content $result -Raw -Encoding UTF8).Trim() } else { 'нет итога' }
    Expect ($p.ExitCode -eq 0) "сервер установленной программы отвечает ($When): $said"
}

Write-Host '1. Компьютер ученика, тихо'
Install @('/ROLE=student', '/PC=ПК-05') 'student.log'
Expect (Test-Path (Join-Path $app 'Sinf.exe')) 'Sinf.exe на месте'
Expect (Test-Path (Join-Path $app 'server/node.exe')) 'сервер на месте'
Expect (Test-Path (Join-Path $app 'content')) 'уроки на месте'
$setupJson = Get-Content (Join-Path $app 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Expect ($setupJson.role -eq 'student' -and $setupJson.pc -eq 'ПК-05') "setup.json: $($setupJson | ConvertTo-Json -Compress)"
Expect (-not (Autostart)) 'без /AUTOSTART с Windows не запускается'
Expect (Test-Path (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Sinf.lnk')) 'значок на рабочем столе — открывать вручную'
Expect (Rule 'Sinf') 'брандмауэр пускает Sinf.exe'
Expect (-not (Rule 'Sinf server')) 'сервер урока на ПК ученика не открыт'
Expect (Test-Path (Join-Path $app 'Sinf.Updater.exe')) 'программа обновления на месте'
Expect (Task 'Sinf\Update') 'задача обновления каждые 30 минут'
Expect (Task 'Sinf\Update at start') 'задача обновления после запуска Windows'
$status = & (Join-Path $app 'Sinf.Updater.exe') --status | Out-String
Write-Host "  Sinf.Updater --status: $($status.Trim())"
Expect ($status -match 'installed 0\.') 'программа обновления видит установленную версию'

Write-Host '1б. Тот же компьютер ученика с /AUTOSTART=1, затем обновление поверх'
Install @('/ROLE=student', '/PC=ПК-05', '/AUTOSTART=1') 'student-autostart.log'
Expect ((Autostart) -eq "`"$app\Sinf.exe`"") "запуск с Windows для всех: $(Autostart)"
Install @('/UPDATE=1') 'student-update.log'
Expect ((Autostart) -eq "`"$app\Sinf.exe`"") 'обновление сохранило запуск с Windows'

Write-Host '2. Тот же компьютер — учителя'
Install @('/ROLE=teacher') 'teacher.log'
$setupJson = Get-Content (Join-Path $app 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Expect ($setupJson.role -eq 'teacher') 'setup.json: учитель'
Expect (-not (Autostart)) 'с Windows больше не запускается'
Expect (Rule 'Sinf') 'брандмауэр пускает Sinf.exe'
Expect (Rule 'Sinf server') 'брандмауэр пускает сервер урока'
SelfTest 'после установки'

Write-Host '3. Обновление поверх, без /ROLE (так его запускает программа обновления)'
Install @('/UPDATE=1') 'update.log'
$setupJson = Get-Content (Join-Path $app 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Expect ($setupJson.role -eq 'teacher') 'роль компьютера сохранилась: учитель'
Expect (-not (Autostart)) 'с Windows по-прежнему не запускается'
Expect (Task 'Sinf\Update') 'задача обновления на месте'
SelfTest 'после обновления'

Write-Host '4. Удаление'
$uninstaller = Join-Path $app 'unins000.exe'
Expect (Test-Path $uninstaller) 'есть программа удаления'
Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
# The uninstaller hands over to a copy of itself in a temporary folder and returns at once.
foreach ($try in 1..60) {
    if (-not (Test-Path (Join-Path $app 'Sinf.exe'))) { break }
    Start-Sleep -Seconds 1
}
Expect (-not (Test-Path (Join-Path $app 'Sinf.exe'))) 'программа удалена'
Expect (-not (Test-Path (Join-Path $app 'setup.json'))) 'setup.json удалён'
Expect (-not (Autostart)) 'автозапуска нет'
Expect (-not (Rule 'Sinf')) 'правила Sinf нет'
Expect (-not (Rule 'Sinf server')) 'правила сервера нет'
Expect (-not (Task 'Sinf\Update')) 'задачи обновления нет'
Expect (-not (Task 'Sinf\Update at start')) 'задачи обновления при запуске нет'
Write-Host 'Установщик в порядке.'
# The last netsh said "no such rule" with exit code 1, as it should: that is not the script's result.
exit 0
