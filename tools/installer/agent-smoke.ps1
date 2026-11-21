<#
.SYNOPSIS
  The agent on a CI runner (stage 6, B7; ADR-024): switched on by the installer, checked, and
  switched off by removing Sinf — the computer is then as it was.

.DESCRIPTION
  Run on a Windows runner (administrator) after the installer was built and the other smoke tests.
    1. Before: what autologon said, that there is no "Ученик" and no SinfAgent service.
    2. A student computer with /AGENT=1: the account (not an administrator), autologon with the
       password in the LSA secret only, Sinf as that account's shell, Task Manager off, the service
       running; the pipe answers and remembers the teacher's lock.
    3. Removal with /REMOVEACCOUNT=1: no service, autologon as before, no secret, no account.
  The watchdog itself needs a real logged-on desktop: docs/pc-test.md, on a spare PC.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$app = Join-Path $env:ProgramFiles 'Sinf'
$winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$logs = Join-Path (Get-Location) 'out/installer-logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$student = 'Ученик'

function Expect([bool]$Ok, [string]$What) {
    if (-not $Ok) { throw "НЕ ТАК: $What" }
    Write-Host "  ok: $What"
}

function Winlogon([string]$Name) { return (Get-ItemProperty -Path $winlogon -ErrorAction SilentlyContinue).$Name }

function Pipe([string]$Line) {
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'Sinf.Agent', [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(5000)
    $writer = New-Object System.IO.StreamWriter($pipe)
    $writer.AutoFlush = $true
    $reader = New-Object System.IO.StreamReader($pipe)
    $writer.WriteLine($Line)
    $answer = $reader.ReadLine()
    $pipe.Dispose()
    return $answer | ConvertFrom-Json
}

Write-Host '1. Как было до агента'
$before = @{ AutoAdminLogon = (Winlogon 'AutoAdminLogon'); DefaultUserName = (Winlogon 'DefaultUserName') }
Write-Host "  автовход до: $($before | ConvertTo-Json -Compress)"
Expect (-not (Get-LocalUser -Name $student -ErrorAction SilentlyContinue)) 'учётки «Ученик» нет'
Expect (-not (Get-Service SinfAgent -ErrorAction SilentlyContinue)) 'службы SinfAgent нет'

Write-Host '2. ПК ученика с агентом (/AGENT=1)'
$setup = (Get-ChildItem 'out/installer/Sinf-setup-*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
$p = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/ROLE=student', '/PC=ПК-09', '/AGENT=1', "/LOG=$(Join-Path $logs 'agent.log')" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Установка: код $($p.ExitCode)" }
$status = & (Join-Path $app 'Sinf.Agent.exe') status | Out-String
Write-Host "--- Sinf.Agent.exe status`n$status"
Expect ($status -match 'enabled: True') 'агент включён'
Expect ($status -match 'service: Running') 'служба работает'
$user = Get-LocalUser -Name $student -ErrorAction SilentlyContinue
Expect ($null -ne $user -and $user.Enabled) 'учётка «Ученик» есть'
$admins = Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { $_.Name }
Expect (-not ($admins -match "\\$student$")) '«Ученик» — не администратор'
Expect ((Winlogon 'AutoAdminLogon') -eq '1' -and (Winlogon 'DefaultUserName') -eq $student) 'автовход в «Ученик»'
Expect ($null -eq (Winlogon 'DefaultPassword')) 'пароля открытым текстом в реестре нет'
Expect ($status -match 'secret: True') 'пароль — в секрете LSA'
Expect ($status -match [regex]::Escape("shell: $app\Sinf.exe")) 'оболочка «Ученика» — Sinf.exe'
Expect ($status -match 'taskManager: off') 'диспетчер задач для «Ученика» выключен'

$hello = Pipe '{"type":"hello"}'
Expect ($hello.ok -and -not $hello.lock) 'канал агента отвечает'
$null = Pipe '{"type":"lock","on":true}'
$again = Pipe '{"type":"hello"}'
Expect ($again.lock) 'агент помнит блокировку учителя'
$nonsense = Pipe '{"type":"unlock-everything"}'
Expect (-not $nonsense.ok) 'непонятное сообщение — отказ'
$null = Pipe '{"type":"lock","on":false}'

Write-Host '3. Удаление с /REMOVEACCOUNT=1'
Start-Process -FilePath (Join-Path $app 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/REMOVEACCOUNT=1' -Wait
foreach ($try in 1..60) {
    if (-not (Test-Path (Join-Path $app 'Sinf.exe'))) { break }
    Start-Sleep -Seconds 1
}
Expect (-not (Test-Path (Join-Path $app 'Sinf.exe'))) 'программа удалена'
Expect (-not (Get-Service SinfAgent -ErrorAction SilentlyContinue)) 'службы SinfAgent нет'
Expect ((Winlogon 'AutoAdminLogon') -eq $before.AutoAdminLogon) "автовход как был: $(Winlogon 'AutoAdminLogon')"
Expect ((Winlogon 'DefaultUserName') -eq $before.DefaultUserName) "пользователь автовхода как был: $(Winlogon 'DefaultUserName')"
Expect (-not (Get-LocalUser -Name $student -ErrorAction SilentlyContinue)) 'учётка «Ученик» удалена'
Write-Host 'Агент в порядке.'
exit 0
