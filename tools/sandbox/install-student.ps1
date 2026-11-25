<#
.SYNOPSIS
  Installs the newest Sinf-setup-*.exe from this folder as a student computer and opens Sinf.
  Runs inside Windows Sandbox at its start (sinf-student.wsb); everything goes when the sandbox
  window closes.

.DESCRIPTION
  - role: student, computer name ПК-99;
  - exit password: sandbox-1234 (the "Выход" button or Ctrl+Alt+Shift+F12);
  - no start with Windows, no agent: the sandbox is closed by its own window anyway.
  The teacher stays on the laptop itself: in the sandbox press "Ввести адрес вручную" and type
  the address from the blue bar of the teacher's window. The search by broadcast does not pass
  the sandbox's network.
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$setup = Get-ChildItem -Path $here -Filter 'Sinf-setup-*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $setup) {
    Write-Host "В папке $here нет Sinf-setup-*.exe. Положите установщик туда и запустите песочницу снова."
    Read-Host 'Enter — закрыть'
    exit 1
}
$log = Join-Path ([Environment]::GetFolderPath('Desktop')) 'sinf-setup.log'
Write-Host "Ставим $($setup.Name) как компьютер ученика ПК-99…"
$p = Start-Process -FilePath $setup.FullName -Wait -PassThru -ArgumentList @(
    '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$log",
    '/ROLE=student', '/PC=ПК-99', '/EXITPASSWORD=sandbox-1234', '/AUTOSTART=0', '/AGENT=0'
)
if ($p.ExitCode -ne 0) {
    Write-Host "Установка не удалась (код $($p.ExitCode)). Журнал: $log"
    Read-Host 'Enter — закрыть'
    exit 1
}
Start-Process -FilePath (Join-Path $env:ProgramFiles 'Sinf\Sinf.exe')
